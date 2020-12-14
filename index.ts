import { ServerPermissions, NO_PERMISSION_ERROR } from './Constants';
import { BServer, LocalPermissions, MinimalBServer } from './classes/BServer'
import { readFileSync } from 'fs';
import { copy, truncate } from 'fs-extra';
import { GlobalPermissions, Server } from './Server';
import DatabaseConnection from './classes/DatabaseConnection';
import path = require('path');
import { propertiesFileToBProperties, permissionsFileToBPermissions } from './localUtil'
import config from './config';
import { DBRefresh, getServers, refreshDB, serverLoad, fullServerSend, setPermission, consoleCommand, changeStatus, createWorld, setOpVal, userPermissionData, copyWorld, serverCopyResponse, deleteWorld } from './packetDef';
import { BProperties } from './classes/BProperties';
import Player from './classes/Player';
import { BWorld } from './classes/BWorld';
import { createInterface } from 'readline';
import { createHash } from 'crypto';
/**
 * node index.js util
 * - hash <password>
 * - adduser <user> <password> <permissions> // Not implemented
*/
if(process.argv[2] == 'util') {
    switch(process.argv[3]) {
        case 'hash':
            console.log(require('crypto').createHash('md5').update(process.argv[4]).digest("hex"));
            break;
        default:
            console.log(`Option "${process.argv[3]}" not recognized. Valid options: [hash]`);
            break;
}
}

const rl = createInterface({
    input: process.stdin,
    output: process.stdout
});
rl.on('line', (line) => {
    if (line === "ports") {
        console.log(Array.from(BServer.portsStarted));
    } else if (line === "19132 started") {
        console.log((BServer.is19132PortStarted));
        console.log(BServer.controls19132?.properties["server-name"])
    } else if (line === "stop") {
        pKill();
    }
})
// import packetDef from 'packetDef.d.ts'

var servers: Map<number, BServer> = new Map();

// var players: Player[] = [];

DatabaseConnection.connect(config);
Server.start(readFileSync(path.join(__dirname, 'browser/index.html'), 'utf-8'));

addListeners();

const serverQuery = DatabaseConnection.query({
    // rowMode: 'array',
    text: 'SELECT * FROM servers',
});
const playerQuery = DatabaseConnection.query({
    text: 'SELECT * FROM players'
});
Promise.all([serverQuery, playerQuery]).then(results => {
    BServer.initTotalServers = results[0].rows.length;
    results[0].rows.forEach(server => {
        const propertiesPromise = propertiesFileToBProperties(path.join(server.path, "server.properties"));
        const permissionsPromise = permissionsFileToBPermissions(path.join(server.path, "permissions.json"));
        Promise.all([propertiesPromise, permissionsPromise]).then(([properties, permissions]) => {
            servers.set(server.id, new BServer(server.id, server.description, server.autostart, properties, permissions, server.path, server.version, JSON.parse(server.allowedusers)));
        });
    });
    results[1].rows.forEach(p => new Player(p.username, p.xuid));
    // console.log(Player.players);
    // BServer.startQueuedServers();
    Server.listen();
});

DatabaseConnection.query({
    text: "SELECT * FROM users",
}).then(result => {
    result.rows.forEach(user => {
        // console.log(JSON.stringify(user));
        Server.dataFromId.set(user.id, {
            // socket: socket,
            username: user.username,
            globalPermissions: user.globalpermissions,
            selectedServer: null,
            perm: user.perm,
            id: user.id
        });
    })
})

function addListeners() {
    Server.addListener("login", (socket, dataIn) => {
        DatabaseConnection.query({
            // rowMode: 'array',
            text: 'SELECT * FROM users WHERE username=$1 AND password=$2',
            values: [dataIn.username, createHash('md5').update(dataIn.password).digest('hex')]
        }).then(result => {
            if(result.rows.length === 0) {
                socket.emit("loginResult", { success: false });
                return;
            }
            const data = result.rows[0];
            socket.emit("loginResult", {
                success: true,
                id: data.id,
                perm: data.perm,
                username: data.username,
                globalPermissions: data.globalpermissions,
            });
            const userData = Server.dataFromId.get(data.id);
            userData.socket = socket;

            Server.dataFromId.set(data.id, userData);
            Server.idFromSocket.set(socket, data.id);
        })
    });
    Server.addListener("disconnect", (socket, reason) => {
        let id = Server.idFromSocket.get(socket);
        if(!id) return;
        let data = Server.dataFromId.get(id);
        data.selectedServer = null;
        data.socket = null;
        Server.dataFromId.set(data.id, data);
        Server.idFromSocket.delete(socket);
    });
    Server.addListener("getServers", async (socket, data: getServers) => {
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
                const userdata = Server.dataFromId.get(Server.idFromSocket.get(socket));
                userdata.selectedServer = results[0].id;
                Server.dataFromId.set(Server.idFromSocket.get(socket), userdata);
                socket.emit("serverList", results);
                servers.get(results[0].id).sendAll(socket);
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
        const server = servers.get(serverId);
        if(server.getUserPermissionLevel(Server.idFromSocket.get(socket)) & LocalPermissions.CAN_EDIT_PROPERTIES) {
            server.autostart = properties.autostart;
            properties.autostart = undefined;
            server.properties = new BProperties(properties);
            server.properties.commit(path.join(server.path, 'server.properties'));
            if(description) {
                server.description = description;
            }
            if(server.status === 'Running') {
                server.clobberWorld({ properties: server.propertiesFull, description: description });
            } else {
                server.clobberWorld({ properties: server.propertiesFull, currentWorld: properties['level-name'], description: description });
            }
        }
    });
    Server.addListener("setPermission", async (socket, { userId: id, perm, serverId: sId }: setPermission) => {
        // @ts-ignore
        // return;
        let userId = Server.idFromSocket.get(socket);
        let user;
        let server = servers.get(sId);
        // console.log(`setPermission. data: { userId: ${id}, perm: ${perm}, serverId: ${sId} } sender: id ${userId}`);
        if(!server) {
            // const packet: permissionSetError = {
            //     success: false,
            //     reason: "Invalid serverId"
            // }
            // socket.emit("permissionSetError", packet);
            return;
        }
        let userToChange;
        user = (await DatabaseConnection.query({
            // rowMode: 'array',
            text: 'SELECT * FROM users WHERE id=$1',
            values: [userId]
        })).rows[0];
        if(!user) {
            // const packet: permissionSetError = {
            //     success: false,
            //     reason: "You don't exist in the database"
            // }
            // socket.emit("permissionSetError", packet);
            return;
        }
        userToChange = (await DatabaseConnection.query({
            // rowMode: 'array',
            text: 'SELECT * FROM users WHERE id=$1',
            values: [id]
        })).rows[0];
        if(!userToChange) {
            // const packet: permissionSetError = {
            //     success: false,
            //     reason: "Invalid userId"
            // }
            // socket.emit("permissionSetError", packet);
            return;
        }
        if((server.getUserPermissionLevel(userId) && server.getUserPermissionLevel(userId) & LocalPermissions.CAN_EDIT_PERMISSIONS) || (user.globalPermissions & GlobalPermissions.CAN_OVERRIDE_LOCAL)) {
            server.allowedUsers.set(id, perm);
            let data: userPermissionData[] = [];
            server.allowedUsers.forEach((val, key) => {
                const user = Server.dataFromId.get(key);
                data.push({
                    id: key,
                    name: user.username,
                    perm: user.perm,
                    access: val
                });
            });
            server.clobberWorld({ allowedUsers: data });
            // socket.emit("permissionSet", packet);
            // socket.emit("debug", { msg: user.username });
        } else {
            // const packet: permissionSetError = {
            //     success: false,
            //     reason: NO_PERMISSION_ERROR
            // }
            // // console.log("Error no permission " + server.getUserPermissionLevel(user));
            // socket.emit("permissionSetError", packet);
        }
        // TODO: set user's new permissions in db
    });
    Server.addListener("refreshDB", (socket, data: refreshDB) => {
        if(Server.dataFromId.get(Server.idFromSocket.get(socket)).globalPermissions & GlobalPermissions.CAN_REFRESH_DB) {
            // FIXME: refresh DB
            const packet: DBRefresh = {
                success: false,
                reason: "Not implemented"
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
        const sId = user.selectedServer;
        const server = servers.get(sId);
        if(server.getUserPermissionLevel(userId) & LocalPermissions.CAN_USE_CONSOLE) {
            server.sendData(data.command); 
        } else {
            // How the heck did this happen? Hacking is likely. Error quietly without responding with any debug info
            console.log("Alert: consoleCommand from unauthorized user " + user.username + " with id " + userId);
        }
    });
    Server.addListener("serverLoad", (socket, data: serverLoad) => {
        // Check that the user has permissions
        const userId = Server.idFromSocket.get(socket);
        const server = servers.get(data.serverId);
        if(server.getUserPermissionLevel(userId) & LocalPermissions.CAN_VIEW) {
            let userData = Server.dataFromId.get(userId);
            userData.selectedServer = data.serverId;
            Server.dataFromId.set(userId, userData);
            // socket.join("sId" + data.serverId);
            setTimeout(() => {
            server.sendAll(socket);
            }, 10);
        }
    });
    Server.addListener("changeStatus", (socket, data: changeStatus) => {
        const server = servers.get(data.serverId);
        const userId = Server.idFromSocket.get(socket);

        if(!(server.getUserPermissionLevel(userId) & LocalPermissions.CAN_SET_STATUS)) return;

        if(data.status == 'Start') server.start();
        if(data.status == 'Stop') server.stop();
    });
    Server.addListener("createWorld", (socket, data: createWorld) => {
        const userId = Server.idFromSocket.get(socket);
        const server = servers.get(data.serverId);
        const perm = server.getUserPermissionLevel(userId);
        if(perm && perm & LocalPermissions.CAN_CREATE_WORLDS) {
            server.createWorld(data);
        }
    });
    Server.addListener("setOpVal", (socket, data: setOpVal) => {
        // console.log(data);
        const user = Server.idFromSocket.get(socket);
        const server = servers.get(data.serverId);
        if(!(server.getUserPermissionLevel(user) & LocalPermissions.CAN_EDIT_PROPERTIES)) return;
        
        // server.permissions = data.permissions;
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
                proms.push(copy(pathToFromWorld, pathToToWorld).then(() => {
                    truncate(pathToToWorld, pathToFile[1]);
                }));
            });
            await Promise.all(proms);
            console.log("Done");
            server.sendData("save resume");
            // serverFrom.
        } else {
            server.worlds[data.toWorld] = new BWorld(server.id, data.toWorld, path.join(server.path, 'worlds', data.toWorld), true);
            await copy(serverFrom.worlds[data.fromWorld].path, server.worlds[data.toWorld].path);
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
        if(!(server.getUserPermissionLevel(id) & LocalPermissions.CAN_DELETE_WORLDS)) {
            return;
        }
        if (await server.deleteWorld(data.world)) {
            // console.log("Clobbering. properties: " + server.properties);
            server.clobberWorld({ worlds: server.worlds, properties: server.propertiesFull, currentWorld: server.currentWorld });
        }
    })
    // Server.addListener("")
}

// function packFromServerId(id: number, userId): fullServerSend {
//     // let user = Server.idFromSocket.get(socket);
//     let server = servers.find(val => val.id === id);
//     if(server.getUserPermissionLevel(userId) && server.getUserPermissionLevel(userId) & LocalPermissions.CAN_VIEW)
//         return {
//             server
//         };
//     return { server: null };
// }


// Deprecated. use clobberWorld instead
// function sendServerUpdates() {
//     servers.forEach((server) => {
//         Server.io.to("sId" + server.id)
//     })
// }
function mapEntriesToString(entries) {
    return Array
      .from(entries, ([k, v]) => `\n  ${k}: ${v}`)
      .join("") + "\n";
  }
// export async function clobberAll() {
//     // data.id = this.id;
//     // Server.dataFromId.forEach(userdata => {
//     //     if(!(this.getUserPermissionLevel(userdata.id) & LocalPermissions.CAN_VIEW)) return;
//     //     const tmpData = Object.assign({}, data);
//     //     if(!(this.getUserPermissionLevel(userdata.id) & LocalPermissions.CAN_EDIT_PERMISSIONS)) tmpData.allowedUsers = undefined;
//     //     if(!(this.getUserPermissionLevel(userdata.id) & LocalPermissions.CAN_USE_CONSOLE)) tmpData.consoleAppend = undefined;
        
//     //     if(userdata.selectedServer == this.id) {
//     //         // console.log("Sending to user id " + userdata.id + " data " + data.status);
//     //         userdata.socket.emit("serverUpdate", data);
//     //     }
//     // })
//     const obj: Promise<MinimalBServer>[] = [];
//     servers.forEach(async server => {
//         Server.dataFromId.forEach(async user => {
//             if (server.getUserPermissionLevel(user.id) & LocalPermissions.CAN_VIEW) {
//                 // if(user.socket) user.socket.emit('clobberAll', await server.createSmallVersion());
//                 if(user.socket) obj.push(server.createSmallVersion());
//             }
//         });
//     });
//     const data = await Promise.all(obj);
//     Server.io.
//     // Server.io.emit('clobberAll', data);
// }
function pKill() {
    console.log("Servers stopping");
    const proms = [];
    servers.forEach(s => proms.push(s.stop()));
    Promise.all(proms).then(() => {
        console.log("Exiting");
        Server.io.emit("serverShutdown");
        process.exit();
    });
}
rl.on('SIGINT', pKill);

//catches uncaught exceptions
// process.on('uncaughtException', pKill);
