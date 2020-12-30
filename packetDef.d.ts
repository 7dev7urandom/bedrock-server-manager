import BPermission from "./classes/BPermissions";
import { BProperties } from "./classes/BProperties";
import { MinimalBServer } from "./classes/BServer";
import Player from "./classes/Player";
import { userIdNum } from './Server';

// #region client to server
interface setPermission {
    userId: userIdNum;
    perm: number;
    serverId: number;
}
interface serverLoad {
    serverId: number;
}
interface getServers {}
interface login {
    username: string;
    password: string;
}

interface changeProperty {
    properties: BProperties;
    serverId: number;
    description?: string;
}

interface consoleCommand {
    command: string;
}

interface createWorld {
    name: string;
    seed: string;
    serverId: number;
    levelType: string;
}

interface setOpVal {
    permissions: BPermission;
    update?: boolean;
    serverId: number;
}

interface createServer {
    name: string;
    description: string;
    version: string;
    type: 'bdsx' | 'elementzeror' | 'vanilla';
    progressBarId: string;
}

// Use changeProperty
// interface selectWorld {
//     name: string;
//     serverId: number;
// }
// #endregion

// #region server to client

interface localPermUpdate {
    serverId: number;
    newPermissions: number;
}

interface globalPermUpdate {
    newPermissions: number;
}

interface loginResult {
    success: boolean;
}
interface loginResultSuccess extends loginResult {
    id: userIdNum;
    perm: string;
    username: string;
    globalPermissions: number;
}
interface serverList {
    servers: MinimalBServer[];
}
interface changeStatus {
    serverId: number;
    status: 'Start' | 'Stop';
}
interface copyWorld {
    fromServer: number;
    fromWorld: string;
    toServer: number;
    toWorld: string;
}
interface deleteWorld {
    serverId: number;
    world: string;
}
// interface serverLoadResultBase {
//     success: boolean;
// }
// interface serverLoadResultSuccess extends serverLoadResultBase {
//     server: BServer;
// }
// interface serverLoadResultError extends serverLoadResultBase {
//     reason: string;
// }
// type serverLoadResult = serverLoadResultSuccess | serverLoadResultError;
interface serverCopyResponse {
    success: boolean;
    reason?: string;
}
interface serverUpdate {
    id?: number;
    consoleAppend?: string;
    properties?: BProperties;
    status?: string;
    worlds?: any;
    currentWorld?: string;
    description?: string;
    allowedUsers?: userPermissionData[];
    controls19132?: boolean;
    output?: string;
    permissions?: BPermission[];
}

interface progressBar {
    id: string;
    text: string;
    progress: number;
}
interface progressBarFinished {
    id: string;
}

interface clobberAll {
    server: MinimalBServer;
}
interface fullServerSend {
    // Wrong, the user may not have permission for the full server
    // server: BServer;
    id: number;
    // name: string; In properties now
    description: string;
    status: string;
    version: string;
    onlinePlayers: Array<Player>;
    properties: BProperties;
    worlds: any;
    whitelist: null;
    access: number;
    controls19132: boolean;
    autostart: boolean;
    permissions?: BPermission[];
    output?: string;
    allowedUsers?: userPermissionData[];
    currentWorld: string;
    type: 'bdsx' | 'elementzeror' | 'vanilla';
}

interface serverDeleted {
    serverId: number;
}

interface refreshDB {}
interface DBRefresh {
    success: boolean;
    reason?: string;
}

// interface permissionSet {
//     id: number;
//     perm: number;
// }
// interface permissionSetSuccess extends permissionSet {
//     id: number;
//     perm: number;
//     serverId: number;
// }
// interface permissionSetError extends permissionSet {
//     reason: string;
// }
interface debug {
    msg: string;
}
// #endregion

interface userPermissionData {
    id: userIdNum;
    name: string;
    perm: string;
    access: number;
}

// Not implemented
