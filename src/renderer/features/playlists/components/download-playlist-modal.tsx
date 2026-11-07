import { useQueryClient } from '@tanstack/react-query';
import isElectron from 'is-electron';
import { useEffect, useState } from 'react';

import { api } from '/@/renderer/api';
import { playlistsQueries } from '/@/renderer/features/playlists/api/playlists-api';
import { useCurrentServerId } from '/@/renderer/store';
import { Button } from '/@/shared/components/button/button';
import { Group } from '/@/shared/components/group/group';
import { Modal } from '/@/shared/components/modal/modal';
import { Progress } from '/@/shared/components/progress/progress';
import { Select } from '/@/shared/components/select/select';
import { Stack } from '/@/shared/components/stack/stack';
import { Switch } from '/@/shared/components/switch/switch';
import { Text } from '/@/shared/components/text/text';
import { toast } from '/@/shared/components/toast/toast';

const downloads = isElectron() ? window.api.downloads : null;

const FORMAT_OPTIONS = [
    { label: 'Original', value: '' },
    { label: 'opus', value: 'opus' },
    { label: 'mp3', value: 'mp3' },
];

const BITRATE_OPTIONS = [
    { label: 'Original', value: '' },
    { label: '320 kbps', value: '320' },
    { label: '192 kbps', value: '192' },
    { label: '128 kbps', value: '128' },
];

const sanitize = (name: string) => name.replace(/[\\/:*?"<>|]/g, '_').trim();

interface DownloadPlaylistModalProps {
    handlers: { close: () => void; open: () => void; toggle: () => void };
    opened: boolean;
    playlistId: string;
    playlistName: string;
}

/**
 * Download/mirror a playlist to a local folder with quality/format choice.
 * "Mirror" removes previously-downloaded tracks that left the playlist (per
 * the folder manifest) — re-running it keeps a smart playlist's folder in
 * sync, the desktop counterpart of Worbus for Android's rolling cache.
 */
export const DownloadPlaylistModal = ({
    handlers,
    opened,
    playlistId,
    playlistName,
}: DownloadPlaylistModalProps) => {
    const serverId = useCurrentServerId();
    const queryClient = useQueryClient();

    const [dir, setDir] = useState(
        () => localStorage.getItem(`playlist-download-dir-${playlistId}`) || '',
    );
    const [format, setFormat] = useState('');
    const [bitrate, setBitrate] = useState('');
    const [mirror, setMirror] = useState(true);
    const [running, setRunning] = useState(false);
    const [progress, setProgress] = useState<null | { current: number; total: number }>(null);

    useEffect(() => {
        if (!downloads) return undefined;
        downloads.onProgress((p) => {
            if (p.done) setProgress(null);
            else setProgress({ current: p.current, total: p.total });
        });
        return () => downloads.removeProgressListener();
    }, []);

    const handleSelectDir = async () => {
        const selected = await downloads?.selectDirectory();
        if (selected) {
            setDir(selected);
            localStorage.setItem(`playlist-download-dir-${playlistId}`, selected);
        }
    };

    const handleStart = async () => {
        if (!downloads || !serverId || !dir) return;
        setRunning(true);
        try {
            const songList = await queryClient.fetchQuery(
                playlistsQueries.songList({ query: { id: playlistId }, serverId }),
            );
            const songs = songList?.items || [];
            if (!songs.length) {
                toast.warn({ message: 'Playlist has no songs' });
                return;
            }

            const transcode = format !== '' || bitrate !== '';
            const files = await Promise.all(
                songs.map(async (song, index) => {
                    const url = await api.controller.getStreamUrl({
                        apiClientProps: { serverId },
                        query: {
                            bitrate: bitrate ? Number(bitrate) : undefined,
                            format: format || undefined,
                            id: song.id,
                            skipAutoTranscode: true,
                            transcode,
                        },
                    });
                    const ext = format || song.container || 'mp3';
                    const filename = sanitize(
                        `${String(index + 1).padStart(3, '0')} - ${song.artistName} - ${song.name}.${ext}`,
                    );
                    return { filename, id: song.id, url: url as string };
                }),
            );

            const result = await downloads.sync({ dir, files, removeOthers: mirror });
            toast.success({
                message:
                    `${result.downloaded} downloaded, ${result.skipped} already present` +
                    (result.renamed ? `, ${result.renamed} renumbered` : '') +
                    (result.removed ? `, ${result.removed} removed` : '') +
                    (result.failed.length ? `, ${result.failed.length} FAILED` : ''),
                title: playlistName,
            });
            if (result.failed.length) {
                toast.error({ message: result.failed.slice(0, 3).join('\n') });
            }
        } catch (error) {
            toast.error({ message: (error as Error).message });
        } finally {
            setRunning(false);
            setProgress(null);
        }
    };

    return (
        <Modal handlers={handlers} opened={opened} size="md" title="Download playlist">
            <Stack gap="md">
                <Group gap="sm" wrap="nowrap">
                    <Button onClick={handleSelectDir} variant="default">
                        Choose folder…
                    </Button>
                    <Text isMuted overflow="hidden" size="sm">
                        {dir || 'No folder selected'}
                    </Text>
                </Group>
                <Group grow>
                    <Select
                        data={FORMAT_OPTIONS}
                        label="Format"
                        onChange={(value) => setFormat(value ?? '')}
                        value={format}
                    />
                    <Select
                        data={BITRATE_OPTIONS}
                        label="Max bitrate"
                        onChange={(value) => setBitrate(value ?? '')}
                        value={bitrate}
                    />
                </Group>
                <Switch
                    checked={mirror}
                    label="Mirror — remove downloaded tracks that left the playlist"
                    onChange={(e) => setMirror(e.currentTarget.checked)}
                />
                {progress && (
                    <Stack gap={4}>
                        <Progress value={(progress.current / progress.total) * 100} />
                        <Text isMuted size="xs">
                            {progress.current} / {progress.total}
                        </Text>
                    </Stack>
                )}
                <Group justify="flex-end">
                    {running ? (
                        <Button onClick={() => downloads?.cancel()} variant="default">
                            Cancel
                        </Button>
                    ) : (
                        <Button disabled={!dir} onClick={handleStart} variant="filled">
                            Download
                        </Button>
                    )}
                </Group>
            </Stack>
        </Modal>
    );
};
