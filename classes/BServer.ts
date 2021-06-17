import { BWorld } from "./BWorld";
import BPermission from './BPermissions';
import { BProperties } from './BProperties';
import { Socket } from "socket.io";
import { Server, GlobalPermissions } from '../Server';
import { createWorld, fullServerSend, serverDeleted, serverUpdate } from '../packetDef';
import { clearTimeout } from "timers";
import { permissionsFileToBPermissions, propertiesFileToBProperties } from '../localUtil';
import Player from "./Player";
// import { clobberAll } from '../index'
// const fs = require('fs-extra');
import * as fs from 'fs-extra';
import { ServerProcess } from "./ServerProcess";
import PluginSystem from "./Plugins";
import DatabaseConnection from "./DatabaseConnection";
// const fsprom = require('fs').promises;
const path = require('path');

export interface MinimalBServer {
    id: number;
    version: string;
    onlinePlayers: Array<Player>;
    'max-players': number;
    access: number;
    'server-port': number;
    status: string;
    controls19132: boolean;
    'server-name': string;
    description: string;
    currentWorld: string;
    type: 'bdsx' | 'vanilla' | 'elementzeror';
}

export abstract class BServer {
    static is19132PortStarted: boolean = false;
    static queuedServers: BServer[] = [];
    static isLaunched: boolean = false;
    static controls19132: BServer | null = null;
    static portsStarted: Set<number> = new Set();
    static initTotalServers: number;
    static servers: Map<number, BServer> = new Map();
    forcedShutdown: boolean = false;
    properties: BProperties | null; //
    id: number; //
    specPermissions: Map<string, BPermission> | null; // xuid -> BPermission
    worlds: { [key: string]: BWorld } = {};
    version: string;
    whitelist: null;
    onlinePlayers: Set<Player> = new Set();
    maxPlayers: number;
    port: number;
    output: string = '';
    proc: ServerProcess;
    path: string;
    status: 'Stopped' | 'Running' | 'Starting' | 'Stopping';
    subscriptions: Map<string, CallableFunction[]> = new Map();
    allowedUsers: Map<number, number> = new Map<number, number>();
    autostart: boolean;
    description: string;
    dataFetched: boolean = false;
    subbedSockets: Socket[];
    stopTimer: NodeJS.Timeout;
    queuedTasks: CallableFunction[] = [];
    currentWorld: string;
    pendingData: string = '';
    queryInterval: NodeJS.Timeout;
    expectLine: ((data: string) => void)[] = [];
    backupResolve: CallableFunction;
    type: 'bdsx' | 'elementzeror' | 'vanilla';
    createdResolve: CallableFunction;
    prepQuery: CallableFunction[] = [];
    env: any;
    command: string[];
    // UUID Session ID defined by proc
    sessionId: string;
    extraData: any;
    // Gets all users mentioned in permissions.json and all players in db
    get permissions() {
        // Make a shallow copy of the map
        const perms = new Map(this.specPermissions);
        Player.xuidToPlayer.forEach(p => {
            if(perms.get(p.xuid)) return;
            perms.set(p.xuid, { player: p, permission: "default"});
        });
        return perms;
    }

    get propertiesFull() {
        const props: any = Object.assign({}, this.properties);
        props.autostart = this.autostart;
        return props;
    }

    get name() {
        return this.properties["server-name"];
    }
    constructor(id: number, desc: string, autostart: boolean, serverPath: string, version: string, allowedusers, whitelist?: null) {
        // console.log("Starting server " + properties["server-name"]);
        this.id = id;
        this.path = serverPath;
        this.version = version;
        this.whitelist = whitelist;
        this.status = "Stopped";
        this.autostart = autostart;
        // this.name = name;
        this.description = desc;
        // console.log(this.properties);
        // this.getData().then(() => {
        // });
        // console.log(mapEntriesToString(allowedusers));
        for (const user in allowedusers) {
            // console.log(result.rows[0].user);
            this.allowedUsers.set(parseInt(user), allowedusers[user]);
        }
        ( async () => {
            let dirhandle;
            try {
                const pathToWorldsFolder = path.join(this.path, 'worlds');
                await fs.ensureDir(pathToWorldsFolder);
                dirhandle = (await fs.readdir(pathToWorldsFolder, { withFileTypes: true }));
                dirhandle.filter(dir => dir.isDirectory()).forEach(dir => {
                    this.worlds[dir.name] = (new BWorld(this.id, dir.name, path.join(pathToWorldsFolder, dir.name)));
                });
            } catch {}
        })();
        this.prepServer().then(() => this.prepQuery.forEach(x => x()));
    }
    async prepServer() {
        // Get properties
        // Get permissions
        const [properties, permissions] = await Promise.all([
            propertiesFileToBProperties(path.join(this.path, "server.properties")),
            permissionsFileToBPermissions(path.join(this.path, "permissions.json"))
        ]);
        this.properties = properties;
        this.currentWorld = this.properties['level-name'];
        this.properties["server-portv6"] = 65000 + this.id;
        await this.properties.commit(path.join(this.path, 'server.properties'));

        this.specPermissions = new Map(permissions.map(p => [p.player.xuid, p]));

        // Start if autostart
        if(!BServer.isLaunched) BServer.initTotalServers--;
        if(this.autostart) {
            this.start().then(() => this.queryCreated());
        } else {
            if(!BServer.initTotalServers) BServer.startQueuedServers();
        }

    }
    abstract spawn(): ServerProcess;
    getUserPermissionLevel(user: number): number {
        // console.log(mapEntriesToString(this.allowedUsers));
        try {
            if (Server.dataFromId.get(user).globalPermissions & GlobalPermissions.CAN_OVERRIDE_LOCAL) return 255;
        } catch (e) {
            console.log("error: " + Array.from(Server.dataFromId.entries()));
        }
        return this.allowedUsers.get(user) ?? 0;
    }
    async start(socket?: Socket) {
        if(this.forcedShutdown) return;
        // console.log(`ID ${this.id} server start port ${this.properties['server-port']}`);
        // console.log(this.command);
        if(this.status !== "Stopped") return;
        // await this.getData();
        if(!BServer.is19132PortStarted && this.properties["server-port"] !== 19132 && !BServer.isLaunched) {
            BServer.queuedServers.push(this);
            // console.log("Queuing server id " + this.id);
            return;
        }
        if(!BServer.initTotalServers && BServer.is19132PortStarted && !BServer.isLaunched) {
            // console.log("init: " + BServer.initTotalServers);
            BServer.startQueuedServers();
        }
        if(BServer.portsStarted.has(this.properties['server-port'])) {
            console.log("Canceling. " + Array.from(BServer.portsStarted));
            if(socket) socket.emit("infoWindow", { msg: `Port ${this.properties['server-port']} is already running.`});
            return;
        }
        BServer.portsStarted.add(this.properties['server-port']);
        if(!BServer.controls19132) {
            // BServer.is19132PortStarted = true;
            BServer.controls19132 = this;
            BServer.portsStarted.add(19132);
        }
        this.status = "Starting";
        this.output = '';
        this.clobberWorld({ output: '' });
        // this.proc = exec(`(cd ${this.path}; LD_LIBRARY_PATH=. ./bedrock_server)`);
        // Temporary for test dev
        // let command;
        // if(this.description === 'A real genuine test of the software') {
        // let command = START_COMMAND;
        // } else {

            // command = `(cd ${this.path} & dummyserver.exe)`;
        // }

        // console.log(command);
        this.proc = this.spawn();
        // this.proc.on('data', data => console.error("The server gave an error message: " + data.toString()));
        this.proc.on('data', bytedata => {
            const data: string = bytedata.toString();
            // console.log("data from server id " + this.id + ": " + data);
            // if(this.description === 'A real genuine test of the software') console.log(data);
            this.pendingData += data;
            const lines = this.pendingData.split("\n");
            this.pendingData = lines.pop();
            lines.forEach((line) => {
                // Fix for IPty instances that repeat the input with backspaces characters every char
                if(line.includes('\b')) return;
                this.recvData(line + '\n');
            });
        });
        this.proc.on('exit', async (code, signal) => {
            if(code !== 0 && this.status !== 'Stopping') {
                // console.log("1");
                console.error(`Server id ${this.id} exited with ${code ? "an error code " : "signal "} ${ code ?? signal }`);
                if(BServer.controls19132 === this) {
                    console.error("Starting other servers anyways as this 19132 server was blocking");
                    // BServer.controls19132 = undefined;
                    // BServer.is19132PortStarted = false;
                    // BServer.startQueuedServers();
                    BServer.isLaunched = true;
                    if(BServer.queuedServers.length)
                        BServer.queuedServers.shift().start();
                }
            }
            if(BServer.controls19132 === this) {
                BServer.controls19132 = undefined;
                BServer.is19132PortStarted = false;
                BServer.portsStarted.delete(19132);
            }
            BServer.portsStarted.delete(this.properties['server-port']);
            this.status = "Stopped";
            this.specPermissions = new Map((await permissionsFileToBPermissions(path.join(this.path, "permissions.json"))).map(p => [p.player.xuid, p]));
            this.properties = await propertiesFileToBProperties(path.join(this.path, "server.properties"));
            this.currentWorld = this.properties['level-name'];
            this.clobberWorld({ status: this.status, currentWorld: this.currentWorld, properties: this.properties });
            this.clobberAll();
            clearTimeout(this.stopTimer);
            PluginSystem.serverStopped(this);
            this.queuedTasks.forEach(c => c());
            this.queuedTasks = [];
        });
        this.clobberAll();
    }
    stop(forceShutdown = false): Promise<void> {
        if(forceShutdown) this.forcedShutdown = true;
        this.onlinePlayers = new Set();
        this.clobberAll();
        return new Promise(resolve => {
            if(this.status === 'Stopped' || this.status === "Stopping") {
                return resolve();
            }
            this.sendData("stop");
            this.status = "Stopping";

            this.clobberAll();
            this.stopTimer = setTimeout(() => {
                this.proc.kill();
                this.status = "Stopped";
                this.clobberAll();
            }, 10000);
            this.queuedTasks.push(() => {
                resolve();
            });
        });
    }
    backupHold(): Promise<[string, number][] | string> {
        return new Promise(resolve => {
            if(this.status === 'Stopped') {
                // const paths = (await fs.readdir(path.join(this.path, 'worlds', this.currentWorld)));
                resolve(path.join(this.path, 'worlds', this.currentWorld));
                return;
            }
            this.sendData('save hold');
            this.queryInterval = setInterval(() => {
                this.sendData('save query');
            }, 500);
            this.sendData('save query');
            this.backupResolve = resolve;
        });
    }
    async recvData(data: string) {
        // if(this.description === 'A real genuine test of the software') console.log(data);
        if (data.includes("Running AutoCompaction..."))
            return;
        if(this.status === "Starting" && data.trim().includes("INFO] Server started."))  {
            if(BServer.controls19132 === this) {
                // console.log("Starting queued servers " + JSON.stringify(BServer.queuedServers) + " ports: " + Array.from(BServer.portsStarted));
                BServer.is19132PortStarted = true;
                BServer.startQueuedServers();
            }
            this.status = "Running";
            this.currentWorld = this.properties['level-name'];
            let dirhandle;
            try {
                const pathToWorldsFolder = path.join(this.path, 'worlds');
                try {
                    await fs.mkdir(pathToWorldsFolder);
                } catch {}
                dirhandle = (await fs.readdir(pathToWorldsFolder, { withFileTypes: true }));
                dirhandle.filter(dir => dir.isDirectory()).forEach(dir => {
                    this.worlds[dir.name] = (new BWorld(this.id, dir.name, path.join(pathToWorldsFolder, dir.name)));
                });
                this.clobberWorld({ worlds: this.worlds });
                //.map(dir => new BWorld(this.id, dir.name, path.join(pathToWorldsFolder, dir.name)));

                // console.log(dirhandle);
                // this.worlds = dirhandle;
            } catch {}
            PluginSystem.serverStarted(this);
            this.clobberAll();
        } else if(this.status === "Stopping" && data.endsWith("Quit correctly\n")) {
            // Stopped correctly, not doing anything with this info currently
        } else if (this.status === "Running" && data.includes("Player connected")) {
            const regex = /\[INFO\] Player connected: (\w+), xuid: (\d+)/.exec(data);
            const username = regex[1];
            const xuid = regex[2];
            if(!Player.xuidToPlayer.get(xuid)) {
                new Player(username, xuid, true);
                this.clobberWorld({ permissions: Array.from(this.permissions.values()) });
            } else if (!Player.xuidToPlayer.get(xuid).username) {
                new Player(username, xuid, true);
                this.clobberWorld({ permissions: Array.from(this.permissions.values()) });
            }
            this.onlinePlayers.add(Player.xuidToPlayer.get(xuid));
            this.clobberAll();
        } else if (this.status === "Running" && data.includes("Player disconnected")) {
            const regex = /\[INFO\] Player disconnected: (\w+), xuid: (\d+)/.exec(data);
            const username = regex[1];
            const xuid = regex[2];
            if(!Player.xuidToPlayer.get(xuid)) {
                new Player(username, xuid, true);
                this.clobberWorld({ permissions: Array.from(this.permissions.values()) });
            } else if (!Player.xuidToPlayer.get(xuid).username) {
                new Player(username, xuid, true);
                this.clobberWorld({ permissions: Array.from(this.permissions.values()) });
            }
            this.onlinePlayers.delete(Player.xuidToPlayer.get(xuid));
            this.clobberAll();
        } else if (this.status === "Running" && data.includes("Stopping server...")) {
            this.status = "Stopping";
            this.clobberAll();
        } else if (data.includes("] Session ID")) {
            this.sessionId = data.match(/\[\d{4}-\d\d-\d\d \d\d:\d\d:\d\d INFO\] Session ID ([-\da-f]+)/)[1] ?? this.sessionId;
            console.log(this.sessionId);
            // console.log(JSON.stringify(this.sessionId));
        }
        // console.log(this.expectLine);
        this.expectLine.forEach(f => {
            // console.log("Calling f: " + f + " with data " + data);
            f(data);
        });
        this.expectLine = [];

        // Run backup
        if(data.includes("Data saved. Files are now ready to be copied.") && this.queryInterval) {
            clearInterval(this.queryInterval);
            this.queryInterval = null;
            // console.log("data: " + data);
            this.expectLine.push((filedata) => {
                // const filedata = data.split("\n")[1];
                const filearr: string[] = filedata.split(", ");
                const dataarr = filearr.map(string => {
                    const vals = /(.+):(\d+)/.exec(string);
                    return [vals[1], parseInt(vals[2])];
                });
                if(this.backupResolve) {
                    this.backupResolve(dataarr);
                    this.backupResolve = undefined;
                }
            });
            // Gathers the files and lengths

            // Copy
            // dataarr.forEach(file => {
            //     copy()
            // })

            // Truncate
        }

        this.output += data;
        this.saveLog(data);
        for (const callback of (this.subscriptions.get('stdout') ?? [])) {
            callback(data, this.output);
        }

        this.clobberWorld({ consoleAppend: data });
    }
    commitPermissions() {
        const obj = [];
        Array.from(this.permissions.values()).forEach(perm => {
            if(perm.permission !== 'default')
                obj.push({ permission: perm.permission, xuid: perm.player.xuid });
        });
        const json = JSON.stringify(obj);
        const filepath = path.join(this.path, "permissions.json");
        fs.writeFile(filepath, json, (err) => {
            if(err) throw err;
        });
    }
    sendData(data) {
        if(this.status !== "Running"){
            console.trace("Tried to sendData to stopped server");
            return;
        }
        this.proc.write(data);
        if(this.proc.proc.write) {
            // IPty instance, saving the input will be handled on the other end
        } else {
            this.output += data + '\n';
            this.clobberWorld({ consoleAppend: data + '\n' });
            this.saveLog("> " + data + '\n');
        }
    }
    async saveLog(toAppend: string) {
        const pathToLog = path.join(this.path, 'logs', new Date().toDateString() + ".txt");
        // Make sure logs dir exists
        await fs.ensureDir(path.join(this.path, 'logs'));
        if(!toAppend) {
            fs.writeFile(pathToLog, this.output, err => {
                if (err) throw err;
            });
            return;
        }
        // Write output to log file
        fs.appendFile(pathToLog, `${Date.now()} ` + toAppend, err => {
            if (err) throw err;
            // console.log("pathToLog: " + pathToLog, "toAppend: " + toAppend);
        });
    }
    subscribe(event: string, callback: CallableFunction) {
        let arr = this.subscriptions.get(event);
        arr = arr ? arr : [];
        arr.push(callback);
        this.subscriptions.set(event, arr);
    }
    async createSmallVersion(userId?: number | Socket): Promise<MinimalBServer> {
        if (typeof(userId) !== "number" && typeof(userId) !== "undefined") userId = Server.idFromSocket.get(userId);
        if (
            userId &&
            (
                !(this.getUserPermissionLevel(userId) & LocalPermissions.CAN_VIEW)
                && !(Server.dataFromId.get(userId).globalPermissions & GlobalPermissions.CAN_OVERRIDE_LOCAL)
            )
        )
            return;
        // if(!this.dataFetched)
        //     await this.getData();
        return {
            id: this.id,
            version: this.version,
            onlinePlayers: Array.from(this.onlinePlayers),
            'max-players': this.properties['max-players'] > 0 ? this.properties['max-players'] : 0,
            'server-port': this.properties['server-port'],
            status: this.status,
            access: userId ? this.getUserPermissionLevel(userId) : undefined,
            controls19132: this === BServer.controls19132,
            // 'level-name': this.properties['level-name'],
            description: this.description,
            'server-name': this.properties['server-name'] ?? this.properties['level-name'],
            currentWorld: this.currentWorld,
            type: this.type
        };
    }
    static startQueuedServers() {
        // console.trace("startQueuedServers says I");
        BServer.isLaunched = true;
        // console.log("Starting queued servers");
        BServer.queuedServers.forEach(server => {
            // console.log("3 1");
            server.start();
            // console.log("3");
        });
        // console.log("3");
        BServer.queuedServers = [];
    }
    clobberWorld(data: serverUpdate) {
        data.id = this.id;
        Server.dataFromId.forEach(userdata => {
            if(!(this.getUserPermissionLevel(userdata.id) & LocalPermissions.CAN_VIEW)) return;
            const tmpData = Object.assign({}, data);
            if(!(this.getUserPermissionLevel(userdata.id) & LocalPermissions.CAN_EDIT_PERMISSIONS)) tmpData.allowedUsers = undefined;
            if(!(this.getUserPermissionLevel(userdata.id) & LocalPermissions.CAN_USE_CONSOLE)) tmpData.consoleAppend = undefined;
            if(!(this.getUserPermissionLevel(userdata.id) & LocalPermissions.CAN_EDIT_PROPERTIES)) tmpData.permissions = undefined;
            if(!(userdata.globalPermissions & GlobalPermissions.CAN_MANAGE_SCRIPTS)) tmpData.extraData = undefined;

            if(userdata.selectedServer === this.id) {
                // console.log("Sending to user id " + userdata.id + " data " + data.status);
                userdata.socket.emit("serverUpdate", tmpData);
            }
        });
    }
// #endregion
    sendAll(socket: Socket, additionalData: any = {}) {
        // Get the userId so we can test for permissions
        const userId = Server.idFromSocket.get(socket);
        const permLevel = this.getUserPermissionLevel(userId);

        // CAN_VIEW permission should already be checked, but check again to make sure
        if(!(permLevel & LocalPermissions.CAN_VIEW)) return;

        const allowedUsers2 = [];
        // Don't do allowedUsers inline because there are several steps
        if(permLevel & LocalPermissions.CAN_EDIT_PERMISSIONS) {
            const done = new Set();
            // Add specific permissions
            this.allowedUsers.forEach((val, key) => {
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
        }
        const props = Object.assign({}, this.properties);
        props['autostart'] = this.autostart;
        // Make a new object to populate with required fields
        const serverData: fullServerSend = {
            id: this.id,
            description: this.description,
            status: this.status,
            version: this.version,
            onlinePlayers: Array.from(this.onlinePlayers),
            properties: props,
            permissions: permLevel & LocalPermissions.CAN_EDIT_PROPERTIES ? Array.from(this.permissions.values()) : undefined, // Vauge, but means can edit in-game permissions if allowed to edit properties
            worlds: this.worlds,
            whitelist: this.whitelist, // Currently always null
            access: permLevel,
            controls19132: this === BServer.controls19132,
            output: permLevel & LocalPermissions.CAN_USE_CONSOLE ? this.output : undefined,
            // path: this.path,
            allowedUsers: allowedUsers2,
            autostart: this.autostart,
            currentWorld: this.currentWorld,
            type: this.type,
            // extraData: Server.dataFromId.get(userId).globalPermissions & GlobalPermissions.CAN_MANAGE_SCRIPTS ? this.extraData : undefined
        };
        Object.assign(serverData, additionalData);
        socket.emit("fullServerSend", serverData);
    }
    async createWorld({name, seed, levelType}: createWorld) {
        // Perms had better be checked. Not verifying

        if(this.worlds[name]) {
            console.log("World already created");
            return;
        }
        this.worlds[name] = new BWorld(this.id, name, path.join(path.join(this.path, 'worlds'), name), false);
        this.properties['level-seed'] = seed;
        this.properties['level-name'] = name;
        this.properties['level-type'] = levelType;
        await this.properties.commit(path.join(this.path, 'server.properties'));
        const restartS = async () => {
            await this.start();
            this.worlds[name].generated = true;
            this.clobberWorld({ worlds: this.worlds, properties: this.properties });
        };
        if(this.status === "Stopped") {
            restartS();
            return;
        }
        this.queuedTasks.push(restartS);
        this.stop();
    }
    /**
     * Permissions need to be checked before calling this function
     */
    async deleteWorld(name) {
        console.log("Deleting, name: " + name);
        console.log(Object.getOwnPropertyNames(this.worlds).find(s => s !== name));
        if(this.currentWorld === name) {
            await this.stop();
            this.properties["level-name"] = Object.getOwnPropertyNames(this.worlds).find(s => s !== name) ?? 'Bedrock level';
            this.properties.commit(path.join(this.path, 'server.properties'));
            this.currentWorld = this.properties["level-name"];
        }
        const success = await this.worlds[name].destroy();
        this.worlds[name] = undefined;
        return success;
    }
    clobberAll() {
        // data.id = this.id;
        // Server.dataFromId.forEach(userdata => {
        //     if(!(this.getUserPermissionLevel(userdata.id) & LocalPermissions.CAN_VIEW)) return;
        //     const tmpData = Object.assign({}, data);
        //     if(!(this.getUserPermissionLevel(userdata.id) & LocalPermissions.CAN_EDIT_PERMISSIONS)) tmpData.allowedUsers = undefined;
        //     if(!(this.getUserPermissionLevel(userdata.id) & LocalPermissions.CAN_USE_CONSOLE)) tmpData.consoleAppend = undefined;

        //     if(userdata.selectedServer === this.id) {
        //         // console.log("Sending to user id " + userdata.id + " data " + data.status);
        //         userdata.socket.emit("serverUpdate", data);
        //     }
        // })

        Server.dataFromId.forEach(async user => {
            if (this.getUserPermissionLevel(user.id) & LocalPermissions.CAN_VIEW) {
                if(user.socket) user.socket.emit('clobberAll', { server: await this.createSmallVersion(user.id) });
            }
        });
        // Server.io.emit('clobberAll', data);
    }
    async delete(deleteData: boolean) {
        console.log(`DELETING server id ${this.id} ${deleteData ? '' : 'not '}including files`);
        BServer.servers.delete(this.id);
        if(deleteData) {
            try {
                await fs.remove(this.path);
            } catch (e) {
                console.log(`Error deleting: ${e}`);
            }
        }
        await DatabaseConnection.query({
            text: `DELETE FROM servers WHERE id = $1`,
            values: [this.id]
        });
        Server.dataFromId.forEach(async user => {
            if (this.getUserPermissionLevel(user.id) & LocalPermissions.CAN_VIEW) {
                if(user.socket) {
                    const data: serverDeleted = {
                        serverId: this.id
                    };
                    user.socket.emit('serverDeleted', data);

                }
            }
        });
    }
    abstract updateCommand(): void;
    async queryCreated() {
        return new Promise<void>((resolve) => {
            this.createdResolve = resolve;
        });
    }
}
export enum LocalPermissions {
    CAN_VIEW             = 0b0000000001,
    CAN_USE_CONSOLE      = 0b0000000010,
    CAN_EDIT_PROPERTIES  = 0b0000000100,
    CAN_CREATE_WORLDS    = 0b0000001000,
    CAN_DELETE_WORLDS    = 0b0000010000,
    CAN_SET_STATUS       = 0b0000100000,
    CAN_EDIT_PERMISSIONS = 0b0001000000,
    IS_CREATOR_OF_SERVER = 0b0010000000
}
