import { createHash } from "crypto";
import { GlobalPermissions, Server } from "../Server";
import Database from "./DatabaseImpl";
import {
    DBRefresh,
    serverLoad,
    setPermission,
    consoleCommand,
    changeStatus,
    createWorld,
    setOpVal,
    copyWorld,
    serverCopyResponse,
    deleteWorld,
    createServer,
    uploadGitRepo,
    changeScriptSetting,
    updateGit,
    deleteServer
} from '../packetDef';
// import { servers } from '../index';
import { LocalPermissions, BServer } from "./BServer";
import { BProperties } from "./BProperties";
import path = require("path");
import { NO_PERMISSION_ERROR } from "../Constants";
import { BDSXServer } from "./BDSXServer";
import { BWorld } from "./BWorld";
import DatabaseConnection from "./DatabaseConnection";
import Player from "./Player";
import { VanillaServer } from "./VanillaServer";
import * as fs from 'fs-extra';

const { servers } = BServer;

export function addListeners() {
    // #region general
    Server.addListener("login", (socket, dataIn) => {
        if(!dataIn.username || !dataIn.password) {
            console.log(`Invalid packet login`);
        }
        const data = Array.from(Server.dataFromId.values()).find(user => user.username === dataIn.username
            && user.password === createHash('md5').update(dataIn.password).digest('hex')
        );
        if(!data) {
            // console.log(data.password);
            console.log(Array.from(Server.dataFromId.values()));
            socket.emit("loginResult", { success: false });
            return;
        }
        const secStr = Database.generateRandomString(10);
        socket.emit("loginResult", {
            success: true,
            id: data.id,
            perm: data.perm,
            username: data.username,
            globalPermissions: data.globalPermissions,
            secretString: secStr,
            users: data.globalPermissions & GlobalPermissions.CAN_MANAGE_OTHER_USERS ? Array.from(Server.dataFromId.values()).map(({ globalPermissions, id, perm, username }) => ({
                globalPermissions,
                id,
                perm,
                username
            })) : undefined
        });
        if(data.socket) {
            data.socket.emit("logout");
            Server.idFromSocket.delete(data.socket);
        }
        data.socket = socket;
        data.secretString = secStr;
        Server.dataFromId.set(data.id, data);
        Server.idFromSocket.set(socket, data.id);
    });
    Server.addListener("disconnect", (socket) => {
        const id = Server.idFromSocket.get(socket);
        if(!id) return;
        const data = Server.dataFromId.get(id);
        data.selectedServer = null;
        data.socket = null;
        data.secretString = null;
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
            });
        } catch (err) {
            // if(err instanceof ServerNotFoundError) {
            //     console.log("Server was not found in database");
            // }
            // else {
            //     console.error(err);
            // }
            console.error(err);
        }
    });
    Server.addListener("serverLoad", (socket, data: serverLoad) => {
        // Check that the user has permissions
        const userId = Server.idFromSocket.get(socket);
        const server = servers.get(data.serverId);
        if(!server) return;
        if(server.getUserPermissionLevel(userId) & LocalPermissions.CAN_VIEW) {
            const userData = Server.dataFromId.get(userId);
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
    // #endregion
    // #region data setters
    Server.addListener("changeProperty", async (socket, { properties, serverId, description }) => {
        if(!serverId) return;
        const server = servers.get(serverId);
        if(!server) return;
        if(!properties) properties = server.properties;
        if(server.getUserPermissionLevel(Server.idFromSocket.get(socket)) & LocalPermissions.CAN_EDIT_PROPERTIES) {
            console.log(server.autostart, properties.autostart);
            if(properties.autostart === 'undefined') properties.autostart = undefined; // Hacky fix for a bug where for some reason properties.autostart is the string undefined
            server.autostart = properties.autostart ?? server.autostart;
            properties.autostart = undefined;
            server.properties = new BProperties(properties);
            server.properties.commit(path.join(server.path, 'server.properties'));
            if(description) {
                server.description = description;
            }
            DatabaseConnection.query({
                text: `UPDATE servers SET description = $1, autostart = $2 where id = $3`,
                values: [server.description ?? '', server.autostart ?? false, server.id]
            });
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
        if(!(id && (typeof perm === 'number') && sId)) return;
        const userId = Server.idFromSocket.get(socket);
        const user = Server.dataFromId.get(userId);
        const server = servers.get(sId);
        const userToChange = Server.dataFromId.get(id);
        if(!server || !user || !userToChange) {
            return;
        }
        if((server.getUserPermissionLevel(userId) && server.getUserPermissionLevel(userId) & LocalPermissions.CAN_EDIT_PERMISSIONS)) {
            server.allowedUsers.set(id, perm);
            const allowedUsers2 = [];
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
                });
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
                });
            });
            server.clobberWorld({ allowedUsers: allowedUsers2 });
            if(Server.dataFromId.get(id).socket) {
                // The user with changed perms in logged in. Let them know it changed
                console.log(`Telling ${Server.dataFromId.get(id).username} localPermUpdate`);
                Server.dataFromId.get(id).socket.emit("localPermUpdate", { serverId: sId, newPermissions: server.allowedUsers.get(id) });
            }
            const obj = {};
            server.allowedUsers.forEach((val, key) => {
                obj[key] = val;
            });
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
    Server.addListener("changeStatus", (socket, data: changeStatus) => {
        const server = servers.get(data.serverId);
        const userId = Server.idFromSocket.get(socket);
        if(!server) return;
        if(!(server.getUserPermissionLevel(userId) & LocalPermissions.CAN_SET_STATUS)) {
            console.warn(`Unauthorized changeStatus from ${Server.dataFromId.get(userId).username} with permissions ${server.getUserPermissionLevel(userId)}`);
            return;
        }

        if(data.status === 'Start') server.start(socket);
        if(data.status === 'Stop') server.stop();
    });
    Server.addListener("setOpVal", (socket, data: setOpVal) => {
        // console.log(data);
        const user = Server.idFromSocket.get(socket);
        const server = servers.get(data.serverId);
        if(!server) return;
        if(!(server.getUserPermissionLevel(user) & LocalPermissions.CAN_EDIT_PROPERTIES)) {
            console.warn(`Unauthorized setOpVal from ${Server.dataFromId.get(user).username} with permissions ${server.getUserPermissionLevel(user)}`);
            return;
        }

        // server.permissions = data.permissions;
        if(!(data.permissions && data.permissions.player && data.permissions.permission)) return;
        let permission = server.specPermissions.get(data.permissions.player.xuid);
        if(!permission) {
            permission = {
                player: Player.xuidToPlayer.get(data.permissions.player.xuid),
                permission: data.permissions.permission
            };
            server.specPermissions.set(data.permissions.player.xuid, permission);
        } else {
            permission.permission = data.permissions.permission;
        }
        server.commitPermissions();
        if(data.update && server.status === 'Running') {
            // if(data.permissions.permission === 'operator') {
            //     server.sendData('op ' + data.permissions.player.username);
            // } else {
            //     server.sendData('deop ' + data.permissions.player.username);
            // }
            server.sendData("permission reload");
        }
    });
    // #endregion
    // #region worlds
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
            socket.emit('serverCopyResponse', res);
            return;
        }
        if(server.worlds[data.toWorld]) {
            const res: serverCopyResponse = {
                success: false,
                reason: 'World exists'
            };
            socket.emit('serverCopyResponse', res);
            return;
        }
        // path doesn't exist
        if(!serverFrom.worlds[data.fromWorld].generated) {
            const res: serverCopyResponse = {
                success: false,
                reason: "Can't copy worlds that aren't generated yet"
            };
            socket.emit('serverCopyResponse', res);
            return;
        }
        if(!['Running', 'Stopped'].includes(serverFrom.status)) return;
        let paths: [string, number][] | string;
        if(serverFrom.currentWorld === data.fromWorld && serverFrom.status === 'Running') {
            paths = await serverFrom.backupHold();
            if(typeof paths === 'string') {
                throw new Error("index.ts error copying world: should never get here");
            }
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
        socket.emit('serverCopyResponse', res);
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
    // #endregion
    // #region plugins
    Server.addListener("uploadGitRepo", (socket, { serverId, repo }: uploadGitRepo) => {
        const server = servers.get(serverId) as BDSXServer;
        if(!(Server.dataFromId.get(Server.idFromSocket.get(socket)).globalPermissions & GlobalPermissions.CAN_MANAGE_SCRIPTS)) return;
        if(server.type !== 'bdsx') return;
        // server.scripts.repo = repo;
        // server.updateGitRepoScripts(socket, true);
        server.addPlugin(repo);
        // TODO: send error message if failed
        // TODO: clobber plugin list
    });
    Server.addListener("installPlugin", (socket, { serverId, name }) => {
        const server = servers.get(serverId) as BDSXServer;
        if(!(Server.dataFromId.get(Server.idFromSocket.get(socket)).globalPermissions & GlobalPermissions.CAN_MANAGE_SCRIPTS)) return;
        if(server.type !== 'bdsx') return;
        server.addPublicPlugin(name);
    });
    Server.addListener("updatePlugin", (socket, { serverId, plugin }: updateGit) => {
        const server = servers.get(serverId) as BDSXServer;
        if(!(Server.dataFromId.get(Server.idFromSocket.get(socket)).globalPermissions & GlobalPermissions.CAN_MANAGE_SCRIPTS)) return;
        if(server.type !== 'bdsx') return;
        server.updatePlugin(plugin);
        // TODO: send error message if failed
    });
    Server.addListener("removePlugin", (socket, { serverId, plugin }) => {
        const server = servers.get(serverId) as BDSXServer;
        if(!(Server.dataFromId.get(Server.idFromSocket.get(socket)).globalPermissions & GlobalPermissions.CAN_MANAGE_SCRIPTS)) return;
        if(server.type !== 'bdsx') return;
        server.removePlugin(plugin);
    });
    // #endregion
    // #region servers
    Server.addListener("createServer", async (socket, { name = 'Dedicated Server', description = 'Description', version = '1.16.200.02', type = "vanilla", progressBarId = ""}: createServer) => {
        const id = Server.idFromSocket.get(socket);
        if(!(Server.dataFromId.get(id).globalPermissions & GlobalPermissions.CAN_CREATE_SERVER)){
            console.warn(`Unauthorized createServer from ${Server.dataFromId.get(id).username} with globalpermissions ${Server.dataFromId.get(id).globalPermissions}`);
            return;
        }
        let server;
        switch(type) {
        case 'bdsx':
            server = await BDSXServer.createNew(name, description, id, progressBarId);
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
    });
    Server.addListener("deleteServer", (socket, { serverId, deleteData }: deleteServer ) => {
        const user = Server.dataFromId.get(Server.idFromSocket.get(socket));
        if(!(user.globalPermissions & GlobalPermissions.CAN_DELETE_SERVER)) return;
        servers.get(serverId)?.delete(deleteData);
    });
    Server.addListener("updateServer", (socket, { serverId }) => {
        const user = Server.dataFromId.get(Server.idFromSocket.get(socket));
        if(!(user.globalPermissions & GlobalPermissions.CAN_CREATE_SERVER)) return;
        const server = servers.get(serverId);
        if(!server || server.type !== 'bdsx') return;
        (server as BDSXServer).update();
    });
    // #endregion
    // #region misc
    Server.addListener("changeScriptSetting", (socket, data: changeScriptSetting) => {
        const server = servers.get(data.serverId) as BDSXServer;
        if(!server) return;
        if(!(server.getUserPermissionLevel(Server.idFromSocket.get(socket)) & LocalPermissions.CAN_EDIT_PROPERTIES)) {
            console.warn(`Unauthorized changeScriptSetting from ${Server.dataFromId.get(Server.idFromSocket.get(socket)).username} with permissions ${server.getUserPermissionLevel(Server.idFromSocket.get(socket))}`);
            return;
        }
        if(!server.isConnectedToProcSocket) return;
        server.extraScriptingTabs
        .find(tab => tab.name === data.tab).properties
        .find(prop => prop.id === data.id).value = data.value;
        server.socket.emit("changeSetting", data);
    });
    /* eslint-disable */
    Server.addListener("refreshDB", async (socket) => {
        if(Server.dataFromId.get(Server.idFromSocket.get(socket)).globalPermissions & GlobalPermissions.CAN_REFRESH_DB) {
            // FIXME: clobber changes
            await Database.refresh();
            const packet: DBRefresh = {
                success: true
            };
        } else {
            const packet: DBRefresh = {
                success: false,
                reason: NO_PERMISSION_ERROR
            };
        }
    });
    /* eslint-enable */
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
    // #endregion
    // #region users
    // TODO: error messages rather than silent aborts
    Server.addListener("userAdd", async (socket, {username, password, perm, globalPermissions}) => {
        const data = Server.dataFromId.get(Server.idFromSocket.get(socket));
        if(!(data.globalPermissions & GlobalPermissions.CAN_MANAGE_OTHER_USERS)) return;
        if(Array.from(Server.dataFromId.values()).find(u => u.username === username)) return;
        const hashed = createHash('md5').update(password).digest('hex');
        let id;
        try {
            id = await DatabaseConnection.insertQueryReturnId({
                text: "INSERT INTO users (username, password, perm, globalpermissions) VALUES ($1, $2, $3, $4)",
                values: [username, hashed, perm, globalPermissions]
            });
        } catch {
            return;
        }
        Server.dataFromId.set(id, {
            username,
            password: hashed,
            perm,
            globalPermissions,
            id,
            selectedServer: null,
            secretString: null
        });
        clobberUserList();
    });
    Server.addListener("userDelete", async (socket, { id }) => {
        const data = Server.dataFromId.get(Server.idFromSocket.get(socket));
        if(!(data.globalPermissions & GlobalPermissions.CAN_MANAGE_OTHER_USERS)) return;
        if(!(typeof id === 'number')) return;
        if(!Server.dataFromId.has(id)) return;
        if(id === Server.idFromSocket.get(socket)) return;
        await DatabaseConnection.query({
            text: "DELETE FROM users WHERE id = $1",
            values: [id]
        });
        const socketid = Array.from(Server.idFromSocket.entries()).find(([, id2]) => id2 === id);
        if(socketid) {
            socketid[0].disconnect(true);
            Server.idFromSocket.delete(socketid[0]);
        }
        Server.dataFromId.delete(id);
        clobberUserList();
    });
    Server.addListener("userSetData", async (socket, { id, username, globalPermissions, perm, password }) => {
        if(Array.from(Server.dataFromId.values()).find(u => u.username === username)) return;
        const callerData = Server.dataFromId.get(Server.idFromSocket.get(socket));
        if(callerData.id === id) return;
        if(!(callerData.globalPermissions & GlobalPermissions.CAN_MANAGE_OTHER_USERS)) return;
        const data = Server.dataFromId.get(id);
        let text = ``;
        const values = [];
        let i = 0;
        if(username) {
            values.push(username);
            text += `username = $${++i}, `;
            data.username = username;
        }
        if(password) {
            const hash = createHash('md5').update(password).digest('hex');
            values.push(hash);
            text += `password = $${++i}, `;
            data.password = hash;
        }
        if(perm) {
            values.push(perm);
            text += `perm = $${++i}, `;
            data.perm = perm;
        }
        if(typeof globalPermissions === 'number') {
            values.push(globalPermissions);
            text += `globalpermissions = $${++i}, `;
            data.globalPermissions = globalPermissions;
        }
        text = text.substring(0, text.length - 2);
        values.push(id);
        text = `UPDATE users SET ${text} WHERE id = $${++i}`;
        try {
            await DatabaseConnection.query({
                text,
                values
            });
        } catch (e) {
            console.log("Error " + e + " with userSetData query with text \"" + text + "\" and values " + values);
        }
        clobberUserList();
    });
    // #endregion
    // Server.addListener("")
}

export function clobberUserList() {
    Array.from(Server.idFromSocket.entries()).forEach(([socket, id]) => {
        if(Server.dataFromId.get(id).globalPermissions & GlobalPermissions.CAN_MANAGE_OTHER_USERS) {
            socket.emit("userlist", {
                users: Array.from(Server.dataFromId.values()).map(({ globalPermissions, id, perm, username }) => ({
                    globalPermissions,
                    id,
                    perm,
                    username
                }))
            });
        }
    });
}
