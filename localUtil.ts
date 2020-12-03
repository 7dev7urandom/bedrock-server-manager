import { BProperties } from "./classes/BProperties";
import BPermission from "./classes/BPermissions";
import { parse } from 'dotenv';
import { readFile } from 'fs';
import { promisify } from 'util';
import Player from "./classes/Player";

const readFileAsync = promisify(readFile);

export async function propertiesFileToBProperties(filePath): Promise<BProperties> {
    //@ts-ignore
    return new BProperties(parse(await readFileAsync(filePath)));
}
//         ret = {
//             levelType: data.levelType,
// gamemode: data.gamemode,
// serverName: data.serverName,
// difficulty: data.difficulty,
// allowCheats: data.allowCheats,
// maxPlayers: data.maxPlayers,
// _onlineMode: data._onlineMode,
// whitelist: data.whitelist,
// port: data.port,
// port6: data.port6,
// _viewDistance: data._viewDistance,
// tickDistance: data.tickDistance,
// playerIdleTimeout: data.playerIdleTimeout,
// _maxThreads: data._maxThreads,
// _levelName: data._levelName,
// _$defaultPlayerPermissionLevel: data.defaultPlayerPermissionLevel,
// _texturepackRequired: data._texturepackRequired,
// contentLogFileEnabled: data.contentLogFileEnabled,
// _compressionThreshold: data._compressionThreshold,
// _serverAuthoritativeMovement: data._serverAuthoritativeMovement,
// _playerMovementScoreThreshold: data._playerMovementScoreThreshold,
// _playerMovementDistanceThreshold: data._playerMovementDistanceThreshold,
// _playerMovementDurationThresholdInMs: data._playerMovementDurationThresholdInMs,
// _correctPlayerMovement: data._correctPlayerMovement,
// _$levelSeed: data.levelSeed
//         }

export async function permissionsFileToBPermissions(filePath): Promise<BPermission[]> {
    let filedata = (await readFileAsync(filePath)).toString();
    let json = JSON.parse(filedata);
    if(!Array.isArray(json)) json = [];
    return json.map(e => { return { player: Player.xuidToPlayer.get(e.xuid) || { xuid: e.xuid }, permission: e.permission } });
    // let set: Set<BPermission> = new Set();
    // arr.forEach(val => set.add(val));
    // return set;
}