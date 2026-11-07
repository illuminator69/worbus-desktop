/**
 * The cast bridge's `hello` (PROTOCOL §3, §12; Worbus P2 design §6.2). Pure, so
 * `hub/auth.harness.ts` can check it.
 *
 * A bridge authenticates with the bridging device's own credential: its device secret (or, never
 * signed in, the shared token). The hub registers `cast-<id>` in that user's space only because
 * `bridgedBy` is the id the secret is bound to - the id the sign-in answered with (R4). Any other
 * `bridgedBy` makes the hub treat the hello as the bound id itself, which would evict this
 * device's own main socket.
 */

export interface CastHelloArgs {
    /** This device's own hub id. */
    bridgedBy: string;
    /** The speaker's mDNS id; the wire id is `cast-<castId>`. */
    castId: string;
    credential: HubCredential;
    /** What the speaker is, from its mDNS record; undefined when the record does not say. */
    kind: string | undefined;
    name: string;
}

export type HubCredential = { auth: { deviceSecret: string } } | { token: string };

export const castHelloFrame = ({ bridgedBy, castId, credential, kind, name }: CastHelloArgs) => ({
    device: {
        bridgedBy,
        // `loadAck` opts this receiver into the transfer acknowledgement (§7.1): a cast load
        // that fails is otherwise invisible for ~20 s, during which every client shows a
        // playing bar over silence. `idleVolume`: a `do:setVolume` is applied also while this
        // speaker is not playing, over a connection made for it, so its row gets a volume
        // slider in every picker. Not a group: a group's receiver listens on a port of its own,
        // which this bridge does not read from the record, and the level would be set on the
        // group's leader instead.
        caps: kind === 'group' ? ['receiver', 'loadAck'] : ['receiver', 'loadAck', 'idleVolume'],
        id: `cast-${castId}`,
        // `kind` tells a cast row from the others in a picker, and a speaker from a TV. Left out
        // when the record did not say (JSON drops undefined).
        kind,
        name,
        platform: 'chromecast',
    },
    t: 'hello' as const,
    ...credential,
});
