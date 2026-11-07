import { XMLBuilder, XMLParser } from 'fast-xml-parser';
import fs from 'fs';
import path from 'path';

const args = process.argv.slice(2);

// Parse flags and positional arguments
const flags = args.filter((arg) => arg.startsWith('--'));
const positionalArgs = args.filter((arg) => !arg.startsWith('--'));
const replaceIfVersionMissing = flags.includes('--replace-if-version-missing');

if (positionalArgs.length > 3) {
    console.error(
        'Usage: node update-app-stream.js [package-file] [date] [metainfo-file] [--replace-if-version-missing]',
    );
    process.exit(1);
}

const packageFile = positionalArgs[0] || path.resolve(process.cwd(), 'package.json');

const packageContent = fs.readFileSync(packageFile, 'utf8');
const packageJson = JSON.parse(packageContent);
const version = packageJson.version;

const time = Math.floor((Date.parse(positionalArgs[1]) || Date.now()) / 1000);
const metainfoFile =
    positionalArgs[2] || path.resolve(process.cwd(), 'app.worbus.desktop.metainfo.xml');

const parser = new XMLParser({ ignoreAttributes: false });
const metainfoContent = fs.readFileSync(metainfoFile, 'utf8');
const metainfo = parser.parse(metainfoContent);

const newRelease = {
    '@_date': new Date(time * 1000).toISOString().split('T')[0],
    '@_type': version.includes('-') ? 'development' : 'stable',
    '@_version': version,
};

// One release parses as an object, several as an array.
const releases = [metainfo.component.releases.release ?? []].flat();
const releaseExists = releases.some((release) => release['@_version'] === version);

// Worbus P5 (design §6.9, S-084): a version already listed is left as committed, so a build does
// not dirty the tree. A missing one is added, or with --replace-if-version-missing becomes the
// only release.
if (releaseExists) {
    console.log(`${metainfoFile} already lists version ${version}`);
    process.exit(0);
}

metainfo.component.releases.release = replaceIfVersionMissing
    ? [newRelease]
    : [newRelease, ...releases];

const builder = new XMLBuilder({
    format: true,
    ignoreAttributes: false,
    indentBy: '  ',
    suppressEmptyNode: true,
});
fs.writeFileSync(metainfoFile, builder.build(metainfo), 'utf8');

console.log(`Updated ${metainfoFile} with version ${version}`);
