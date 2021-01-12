import { NO_PERMISSION_ERROR, config } from './Constants';
import { BServer, LocalPermissions } from './classes/BServer'
import  * as fs from 'fs-extra';
import { GlobalPermissions, Server } from './Server';
import { BDSXServer } from './classes/BDSXServer';
import { VanillaServer } from './classes/VanillaServer';
import DatabaseConnection from './classes/DatabaseConnection';
import path = require('path');
import { propertiesFileToBProperties, permissionsFileToBPermissions } from './localUtil'
import { 
    DBRefresh, 
    getServers, 
    refreshDB,
    serverLoad,
    setPermission,
    consoleCommand,
    changeStatus,
    createWorld,
    setOpVal,
    copyWorld,
    serverCopyResponse,
    deleteWorld,
    createServer
} from './packetDef';
import { BProperties } from './classes/BProperties';
import Player from './classes/Player';
import { BWorld } from './classes/BWorld';
import { createInterface } from 'readline';
import { createHash } from 'crypto';
import { exec } from 'child_process';
import Database from './classes/DatabaseImpl';

    
config.bdsDownloads = config.bdsDownloads ?? path.join(config.basePath, 'bdsDownloads');
/**
 * node index.js util
 * - hash <password>
 * - adduser <user> <password> <permissions> // FIXME: Not implemented
 */
if(process.argv[2] == 'util') {
    switch(process.argv[3]) {
        case 'hash':
            console.log(require('crypto').createHash('md5').update(process.argv[4]).digest("hex"));
            process.exit();
        default:
            console.log(`Option "${process.argv[3]}" not recognized. Valid options: [hash]`);
            break;
    }
}
if(process.platform == 'win32') {
    BDSXServer.wineName = true; // Doesn't matter, won't be used. Must be truthy
    BDSXServer.wineNameFound();
} else {
    console.log("Checking for wine...");
    getWineName().then(x => {
        BDSXServer.wineName = x;
        console.log("Wine found");
        BDSXServer.wineNameFound();
    });
}

const rl = createInterface({
    input: process.stdin,
    output: process.stdout
});
rl.on('line', async (line) => {
    if (line === "ports") {
        console.log(Array.from(BServer.portsStarted));
    } else if (line === "19132 started") {
        console.log((BServer.is19132PortStarted));
        console.log(BServer.controls19132?.properties["server-name"])
    } else if (line === "stop") {
        pKill();
    } else if (line === 'servers') {
        console.log(Array.from(servers.keys()));
    }
})
// import packetDef from 'packetDef.d.ts'

export var servers: Map<number, BServer> = new Map();

// var players: Player[] = [];

// DatabaseConnection.connect(config);
Server.start(fs.readFileSync(path.join(__dirname, 'browser/index.html'), 'utf-8'));

addListeners();

// DatabaseConnection.verifyTables();

Database.initializeDatabaseData(config).then(() => {
    Server.listen();
});

function addListeners() {
    Server.addListener("login", (socket, dataIn) => {
        if(!dataIn.username || !dataIn.password) {
            console.log(`Invalid packet login`);
        };
        const data = Array.from(Server.dataFromId.values()).find(user => user.username === dataIn.username && user.password === createHash('md5').update(dataIn.password).digest('hex'));
        if(!data) {
            socket.emit("loginResult", { success: false });
            return;
        }
        socket.emit("loginResult", {
            success: true,
            id: data.id,
            perm: data.perm,
            username: data.username,
            globalPermissions: data.globalPermissions,
        });
        if(data.socket) {
            data.socket.emit("logout");
            Server.idFromSocket.delete(data.socket);
        }
        data.socket = socket;

        Server.dataFromId.set(data.id, data);
        Server.idFromSocket.set(socket, data.id);
        // DatabaseConnection.query({
        //     // rowMode: 'array',
        //     text: 'SELECT * FROM users WHERE username=$1 AND password=$2',
        //     values: [dataIn.username, createHash('md5').update(dataIn.password).digest('hex')]
        // }).then(result => {
        //     if(result.rows.length === 0) {
        //         socket.emit("loginResult", { success: false });
        //         return;
        //     }
        //     const data = result.rows[0];
        //     socket.emit("loginResult", {
        //         success: true,
        //         id: data.id,
        //         perm: data.perm,
        //         username: data.username,
        //         globalPermissions: data.globalpermissions,
        //     });
        //     const userData = Server.dataFromId.get(data.id);
        //     if(userData.socket) {
        //         userData.socket.emit("logout");
        //         Server.idFromSocket.delete(userData.socket);
        //     }
        //     userData.socket = socket;

        //     Server.dataFromId.set(data.id, userData);
        //     Server.idFromSocket.set(socket, data.id);
        // })
    });
    Server.addListener("disconnect", (socket) => {
        let id = Server.idFromSocket.get(socket);
        if(!id) return;
        let data = Server.dataFromId.get(id);
        data.selectedServer = null;
        data.socket = null;
        Server.dataFromId.set(data.id, data);
        Server.idFromSocket.delete(socket);
    });
    Server.addListener("getServers", async (socket) => {
        try {
            const proms = [];
            servers.forEach(server => {
                if(!(server.getUserPermissionLevel(Server.idFromSocket.get(socket)) & LocalPermissions.CAN_VIEW)) {
                    // console.log("no perms for " + Server.idFromSocket.get(socket) + ". perms: " + mapEntriesToString(server.allowedUsers));
                    return;
                }
                proms.push(server.createSmallVersion(socket));
            });
            Promise.all(proms).then((results) => {
                // console.log(results);
                // FIXME: check results length
                socket.emit("serverList", results);
                // if(results.length) {
                //     const userdata = Server.dataFromId.get(Server.idFromSocket.get(socket));
                //     userdata.selectedServer = results[0].id;
                //     Server.dataFromId.set(Server.idFromSocket.get(socket), userdata);
                //     servers.get(results[0].id).sendAll(socket);
                // }
            })
        }
        catch (err) {
            // if(err instanceof ServerNotFoundError) {
            //     console.log("Server was not found in database");
            // }
            // else {
            //     console.error(err);
            // }
            console.error(err); 
        }
    });
    Server.addListener("changeProperty", async (socket, { properties, serverId, description }) => {
        if(!serverId) return;
        const server = servers.get(serverId);
        if(!server) return;
        if(!properties) properties = server.properties;
        if(server.getUserPermissionLevel(Server.idFromSocket.get(socket)) & LocalPermissions.CAN_EDIT_PROPERTIES) {
            server.autostart = properties.autostart;
            properties.autostart = undefined;
            server.properties = new BProperties(properties);
            server.properties.commit(path.join(server.path, 'server.properties'));
            if(description) {
                server.description = description;
                DatabaseConnection.query({
                    text: `UPDATE servers SET description = $1 where id = $2`,
                    values: [description, server.id]
                });
            }
            if(server.status === 'Running') {
                server.clobberWorld({ properties: server.propertiesFull, description: description });
            } else {
                server.clobberWorld({ properties: server.propertiesFull, currentWorld: properties['level-name'], description: description });
            }
        } else {
            console.warn(`Unauthorized changeProperty from ${Server.dataFromId.get(Server.idFromSocket.get(socket)).username} with permissions ${server.getUserPermissionLevel(Server.idFromSocket.get(socket))}`);
        }
    });
    Server.addListener("setPermission", async (socket, { userId: id, perm, serverId: sId }: setPermission) => {
        if(!(id && perm && sId)) return;
        let userId = Server.idFromSocket.get(socket);
        let user = Server.dataFromId.get(userId);
        let server = servers.get(sId);
        let userToChange = Server.dataFromId.get(id);
        if(!server || !user || !userToChange) {
            return;
        }
        if((server.getUserPermissionLevel(userId) && server.getUserPermissionLevel(userId) & LocalPermissions.CAN_EDIT_PERMISSIONS)) {
            server.allowedUsers.set(id, perm);
            let allowedUsers2 = [];
            // Don't do allowedUsers inline because there are several steps
            const done = new Set();
            // Add specific permissions
            server.allowedUsers.forEach((val, key) => {
                const user = Server.dataFromId.get(key);
                allowedUsers2.push({
                    id: key,
                    name: user.username,
                    perm: user.perm,
                    access: val
                })
                done.add(key);
            });
            // Add all the other ones in case the aren't in there already so that all users are in the list
            Server.dataFromId.forEach((val, key) => {
                if(done.has(key)) return;
                const access = val.globalPermissions & GlobalPermissions.CAN_OVERRIDE_LOCAL ? 255 : 0;
                allowedUsers2.push({
                    id: key,
                    name: val.username,
                    perm: val.perm,
                    access
                })
            })
            server.clobberWorld({ allowedUsers: allowedUsers2 });
            if(Server.dataFromId.get(id).socket) {
                // The user with changed perms in logged in. Let them know it changed
                console.log(`Telling ${Server.dataFromId.get(id).username} localPermUpdate`);
                Server.dataFromId.get(id).socket.emit("localPermUpdate", { serverId: sId, newPermissions: server.allowedUsers.get(id) });
            }
            const obj = {};
            server.allowedUsers.forEach((val, key) => {
                obj[key] = val;
            })
            DatabaseConnection.query({
                text: `UPDATE servers SET allowedUsers = $1 WHERE id = $2`,
                values: [JSON.stringify(obj), server.id]
            });
        } else {
            // const packet: permissionSetError = {
            //     success: false,
            //     reason: NO_PERMISSION_ERROR
            // }
            console.warn(`Unauthorized setPermission from ${Server.dataFromId.get(Server.idFromSocket.get(socket)).username} with permissions ${server.getUserPermissionLevel(Server.idFromSocket.get(socket))}`);
            // socket.emit("permissionSetError", packet);
        }
    });
    Server.addListener("refreshDB", async (socket) => {
        if(Server.dataFromId.get(Server.idFromSocket.get(socket)).globalPermissions & GlobalPermissions.CAN_REFRESH_DB) {
            // FIXME: clobber changes
            await Database.refresh();
            const packet: DBRefresh = {
                success: true
            }
        } else {
            const packet: DBRefresh = {
                success: false,
                reason: NO_PERMISSION_ERROR
            }
        }
    });
    Server.addListener("consoleCommand", (socket, data: consoleCommand) => {
        const userId = Server.idFromSocket.get(socket);
        const user = Server.dataFromId.get(userId);
        if(!user) return;
        const sId = user.selectedServer;
        const server = servers.get(sId);
        if(!server) return;
        if(server.getUserPermissionLevel(userId) & LocalPermissions.CAN_USE_CONSOLE) {
            server.sendData(data.command); 
        } else {
            console.warn(`Unauthorized consoleCommand from ${user.username} with permissions ${server.getUserPermissionLevel(userId)}`);
            // console.log("Alert: consoleCommand from unauthorized user " + user.username + " with id " + userId);
        }
    });
    Server.addListener("serverLoad", (socket, data: serverLoad) => {
        // Check that the user has permissions
        const userId = Server.idFromSocket.get(socket);
        const server = servers.get(data.serverId);
        if(!server) return;
        if(server.getUserPermissionLevel(userId) & LocalPermissions.CAN_VIEW) {
            let userData = Server.dataFromId.get(userId);
            userData.selectedServer = data.serverId;
            Server.dataFromId.set(userId, userData);
            // socket.join("sId" + data.serverId);
            setTimeout(() => {
                server.sendAll(socket);
            }, 10);
        } else {
            console.warn(`Unauthorized serverLoad from ${Server.dataFromId.get(userId).username} with permissions ${server.getUserPermissionLevel(userId)}`);
        }
    });
    Server.addListener("changeStatus", (socket, data: changeStatus) => {
        const server = servers.get(data.serverId);
        const userId = Server.idFromSocket.get(socket);
        if(!server) return;
        if(!(server.getUserPermissionLevel(userId) & LocalPermissions.CAN_SET_STATUS)) {
            console.warn(`Unauthorized changeStatus from ${Server.dataFromId.get(userId).username} with permissions ${server.getUserPermissionLevel(userId)}`);
            return;
        };

        if(data.status == 'Start') server.start();
        if(data.status == 'Stop') server.stop();
    });
    Server.addListener("createWorld", (socket, data: createWorld) => {
        const userId = Server.idFromSocket.get(socket);
        const server = servers.get(data.serverId);
        if(!(server && data.name && data.levelType)) return;
        const perm = server.getUserPermissionLevel(userId);
        if(perm && perm & LocalPermissions.CAN_CREATE_WORLDS) {
            data.name = data.name.trim();
            data.seed = data.seed.trim();
            data.levelType = data.levelType.trim();
            server.createWorld(data);
        } else {
            console.warn(`Unauthorized createWorld from ${Server.dataFromId.get(userId).username} with permissions ${perm}`);
        }
    });
    Server.addListener("setOpVal", (socket, data: setOpVal) => {
        // console.log(data);
        const user = Server.idFromSocket.get(socket);
        const server = servers.get(data.serverId);
        if(!server) return;
        if(!(server.getUserPermissionLevel(user) & LocalPermissions.CAN_EDIT_PROPERTIES)) {
            console.warn(`Unauthorized setOpVal from ${Server.dataFromId.get(user).username} with permissions ${server.getUserPermissionLevel(user)}`);
            return;
        };
        
        // server.permissions = data.permissions;
        if(!(data.permissions && data.permissions.player && data.permissions.permission)) return;
        let permission = server.specPermissions.get(data.permissions.player.xuid);
        if(!permission) {
            permission = {
                player: Player.xuidToPlayer.get(data.permissions.player.xuid),
                permission: data.permissions.permission
            }
            server.specPermissions.set(data.permissions.player.xuid, permission);
        } else {
            permission.permission = data.permissions.permission;
        }
        server.commitPermissions();
        if(data.update) {
            // if(data.permissions.permission === 'operator') {
            //     server.sendData('op ' + data.permissions.player.username);
            // } else {
            //     server.sendData('deop ' + data.permissions.player.username);
            // }
            server.sendData("permission reload");
        }
    });
    Server.addListener("copyWorld", async (socket, data: copyWorld) => {
        const server = servers.get(data.toServer);
        const serverFrom = servers.get(data.fromServer);
        if(!(server && serverFrom && data.fromWorld && data.toWorld)) return;
        if(!(server.getUserPermissionLevel(Server.idFromSocket.get(socket)) & LocalPermissions.CAN_CREATE_WORLDS)
            || !(serverFrom.getUserPermissionLevel(Server.idFromSocket.get(socket)) & LocalPermissions.CAN_VIEW)) {
            const res: serverCopyResponse = {
                success: false,
                reason: NO_PERMISSION_ERROR
            };
            socket.send('serverCopyResponse', res);
            return;
        }
        if(server.worlds[data.toWorld]) {
            const res: serverCopyResponse = {
                success: false,
                reason: 'World exists'
            };
            socket.send('serverCopyResponse', res);
            return;
        }
        // path doesn't exist
        if(!serverFrom.worlds[data.fromWorld].generated) {
            const res: serverCopyResponse = {
                success: false,
                reason: "Can't copy worlds that aren't generated yet"
            };
            socket.send('serverCopyResponse', res);
            return;
        }
        let paths: [string, number][];
        if(serverFrom.currentWorld === data.fromWorld) {
            paths = await serverFrom.backupHold();
            server.worlds[data.toWorld] = new BWorld(server.id, data.toWorld, path.join(server.path, 'worlds', data.toWorld), true);
            const proms: Promise<void>[] = [];
            paths.forEach(pathToFile => {
                const pathToFromWorld = path.join(serverFrom.path, 'worlds', pathToFile[0]);
                const pathToToWorld = path.join(server.path, 'worlds', pathToFile[0].replace(data.fromWorld, data.toWorld));
                proms.push(fs.copy(pathToFromWorld, pathToToWorld).then(() => {
                    fs.truncate(pathToToWorld, pathToFile[1]);
                }));
            });
            await Promise.all(proms);
            console.log("Done");
            server.sendData("save resume");
            // serverFrom.
        } else {
            server.worlds[data.toWorld] = new BWorld(server.id, data.toWorld, path.join(server.path, 'worlds', data.toWorld), true);
            await fs.copy(serverFrom.worlds[data.fromWorld].path, server.worlds[data.toWorld].path);
        }
        const res: serverCopyResponse = {
            success: true,
            // reason: 'World exists'
        };
        socket.send('serverCopyResponse', res);
        server.clobberWorld({ worlds: server.worlds });
    });
    Server.addListener('deleteWorld', async (socket, data: deleteWorld) => {
        const id = Server.idFromSocket.get(socket);
        const server = servers.get(data.serverId);
        if(!server || !data.world) return;
        if(!(server.getUserPermissionLevel(id) & LocalPermissions.CAN_DELETE_WORLDS)) {
            console.warn(`Unauthorized deleteWorld from ${Server.dataFromId.get(id).username} with permissions ${server.getUserPermissionLevel(id)}`);
            return;
        }
        if (await server.deleteWorld(data.world)) {
            // console.log("Clobbering. properties: " + server.properties);
            server.clobberWorld({ worlds: server.worlds, properties: server.propertiesFull, currentWorld: server.currentWorld });
        }
    });
    Server.addListener("createServer", async (socket, { name = 'Dedicated Server', description = 'Description', version = '1.16.200.02', type = "vanilla", progressBarId = ""}: createServer) => {
        const id = Server.idFromSocket.get(socket);
        if(!(Server.dataFromId.get(id).globalPermissions & GlobalPermissions.CAN_CREATE_SERVER)){
            console.warn(`Unauthorized createServer from ${Server.dataFromId.get(id).username} with globalpermissions ${Server.dataFromId.get(id).globalPermissions}`);
            return;
        } 
        let server;
        switch(type) {
            case 'bdsx':
                server = await BDSXServer.createNew(name, description, version, id, progressBarId);
                servers.set(server.id, server);
                server.clobberAll();
                break;
            case 'vanilla':
                server = await VanillaServer.createNew(name, description, version, id, progressBarId);
                servers.set(server.id, server);
                server.clobberAll();
                break;
            default:
                console.log("Unrecognized createServer type " + type + " from (verified) user " + Server.dataFromId.get(id).username + ". Ignoring.");
                break;
        }
    })
    // Server.addListener("")
}


function pKill() {
    console.log("Servers stopping");
    const proms = [];
    try {
        servers.forEach(s => proms.push(s.stop()));
    } catch {
        console.error("Error stopping servers. Ending now.");
        process.exit();
    }
    Promise.all(proms).then(() => {
        console.log("Exiting");
        Server.io.emit("logout");
        process.exit();
    }).catch(err => {
        process.exit();
    });
}
rl.on('SIGINT', pKill);
process.on('SIGTERM', pKill);

//catches uncaught exceptions
process.on('uncaughtException', (err, origin) => {
    console.error(err);
    console.error(`Error in ${origin}`);
    pKill();
});
process.on('unhandledRejection', (reason, promise) => {
    console.error('Unhandled Rejection at:', promise, 'reason:', reason);
    pKill();
});

class WineNotFoundError extends Error {
    constructor(str = "Wine is not installed! Modded servers cannot be run.") {
        super(str);
    }
}

async function getWineName(): Promise<string | false> {
    return new Promise(resolve => {
        if(process.platform === 'win32') {
            resolve('wine');
            return;
        }
        exec(`command -v wine`, (err, stdout) => {
            if(err) throw err;
            // console.log(stdout);
            if(stdout.includes("wine")) {
                resolve(`wine`);
            } else {
                exec(`command -v wine64`, (err, stdout) => {
                    if(err) throw err;
                    if(stdout.includes("wine64")) {
                        resolve(`wine64`);
                    } else {
                        throw new WineNotFoundError();
                    }
                });
            }
        });
    });
}
