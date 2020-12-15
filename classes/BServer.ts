import { BWorld } from "./BWorld";
import BPermission from './BPermissions';
import { BProperties } from './BProperties';
import { ChildProcess, exec } from "child_process";
import { Socket } from "socket.io";
import { Server, GlobalPermissions } from '../Server'
import { ServerPermissions } from '../Constants';
import { createWorld, fullServerSend, serverUpdate } from '../packetDef';
import { clearTimeout } from "timers";
import { permissionsFileToBPermissions, propertiesFileToBProperties } from '../localUtil';
import Player from "./Player";
// import { clobberAll } from '../index'
// const fs = require('fs-extra');
import * as fs from 'fs-extra';
// const fsprom = require('fs').promises;
const path = require('path');

export class ServerNotFoundError extends Error {

}

export interface MinimalBServer {
    id: number;
    version: string;
    onlinePlayers: number;
    'max-players': number;
    access: number;
    'server-port': number;
    status: string;
    controls19132: boolean;
    'server-name': string;
    description: string;
    currentWorld: string;
}

export class BServer {
    static is19132PortStarted: boolean = false;
    static queuedServers: BServer[] = [];
    static isLaunched: boolean = false;
    static controls19132: BServer | null = null;
    static portsStarted: Set<number> = new Set();
    static initTotalServers: number;
    properties: BProperties | null; //
    id: number; //
    specPermissions: Map<string, BPermission> | null; // xuid -> BPermission
    worlds: { [key: string]: BWorld } = {};
    version: string;
    whitelist: null;
    onlinePlayers: number;
    maxPlayers: number;
    port: number;
    output: string = '';
    proc: ChildProcess;
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
    // #region test

    // Gets all users mentioned in permissions.json and all players in db
    get permissions() {
        const allPlayers = Player.players;

        // Make a shallow copy of the map
        const perms = new Map(this.specPermissions);
        allPlayers.forEach(p => {
            if(perms.get(p.xuid)) return;
            perms.set(p.xuid, { player: p, permission: "default"});
        })
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
    constructor(id: number, desc: string, autostart: boolean, properties: BProperties, permissions: BPermission[], serverPath: string, version: string, allowedusers, whitelist?: null) {
        // console.log("Starting server " + properties["server-name"]);
        BServer.initTotalServers--;
        this.properties = properties;
        this.id = id;
        this.specPermissions = new Map(permissions.map(p => [p.player.xuid, p]));
        this.path = serverPath;
        this.version = version;
        this.whitelist = whitelist;
        this.status = "Stopped";
        this.autostart = autostart;
        // this.name = name;
        this.description = desc;
        this.currentWorld = this.properties['level-name'];
        this.properties["server-portv6"] = 65000 + this.id;
        this.properties.commit(path.join(this.path, 'server.properties'));
        // this.getData().then(() => {
        if(this.autostart) this.start();
        // });
        // console.log(mapEntriesToString(allowedusers));
        for (let user in allowedusers) {
            // console.log(result.rows[0].user);
            this.allowedUsers.set(parseInt(user), allowedusers[user]);
        }
        ( async () => {
            let dirhandle;
            try {
                const pathToWorldsFolder = path.join(this.path, 'worlds');
                await fs.mkdir(pathToWorldsFolder).catch(() => {});
                dirhandle = (await fs.readdir(pathToWorldsFolder, { withFileTypes: true }));
                dirhandle.filter(dir => dir.isDirectory()).forEach(dir => {
                    this.worlds[dir.name] = (new BWorld(this.id, dir.name, path.join(pathToWorldsFolder, dir.name)));
                });
            }
            finally {}
        })();
    }
    getUserPermissionLevel(user: number): number {
        // console.log(mapEntriesToString(this.allowedUsers));
        try {
            if (Server.dataFromId.get(user).globalPermissions & GlobalPermissions.CAN_OVERRIDE_LOCAL) return 255;
        } catch (e) {
            console.log("error: " + Array.from(Server.dataFromId.entries()))
        }
        return this.allowedUsers.get(user) || 0;
    }
    async start() {
        // console.log(`ID ${this.id} server start port ${this.properties['server-port']}`);
        if(this.status === "Running") return;
        // await this.getData();
        if(!BServer.is19132PortStarted && this.properties["server-port"] !== 19132 && !BServer.isLaunched && BServer.initTotalServers) {
            BServer.queuedServers.push(this);
            // console.log("Queuing server id " + this.id);
            return;
        }
        if(!BServer.initTotalServers) {
            BServer.startQueuedServers();
        }
        if(BServer.portsStarted.has(this.properties['server-port'])) {
            console.log("Canceling. " + Array.from(BServer.portsStarted));
            return;
        }
        BServer.portsStarted.add(this.properties['server-port']);
        if(!BServer.is19132PortStarted) {
            // BServer.is19132PortStarted = true;
            BServer.controls19132 = this;
            BServer.portsStarted.add(19132);
        }
        this.status = "Starting";
        this.output = '';
        // this.proc = exec(`(cd ${this.path}; LD_LIBRARY_PATH=. ./bedrock_server)`);
        // Temporary for test dev
        // let command;
        // if(this.description == 'A real genuine test of the software') {
        let command;
        if(process.platform === 'win32') {
            command = `(cd ${this.path} & bedrock_server.exe)`;
        } else if (process.platform === 'linux') {
            command = `cd ${this.path} && LD_LIBRARY_PATH=. ./bedrock_server`;
        }
        // } else {

            // command = `(cd ${this.path} & dummyserver.exe)`;
        // }

        // console.log(command);
        this.proc = exec(command);
        this.proc.stderr.on('data', data => console.error("I have literally no idea what to do right now. The server gave an error message: " + data.toString()));
        this.proc.stdout.on('data', bytedata => {
            const data: string = bytedata.toString();
            // console.log("data from server id " + this.id + ": " + data);
            // if(this.description == 'A real genuine test of the software') console.log(data);
            this.pendingData += data;
            if(this.pendingData.endsWith("\n")) {
                this.recvData(this.pendingData);
                this.pendingData = '';
            }
        });
        this.proc.on('exit', async code => {
            if(code != 0) {
                console.error("I have literally no idea what to do right now. The server exited with an error code " + code);
                if(BServer.controls19132 === this) {
                    console.error("Starting other servers anyways as this 19132 server was blocking");
                    // BServer.controls19132 = undefined;
                    // BServer.is19132PortStarted = false;
                    BServer.startQueuedServers();
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
            // console.log("Stopped, running queued tasks: ", this.queuedTasks);
            // Wait a little bit before running queuedTasks so the server can confirm stopped before doing anything else
            // setTimeout(() => this.queuedTasks.forEach(c => c()), 10);
            this.queuedTasks.forEach(c => c());
            this.queuedTasks = [];
        });
        this.clobberAll();
    }
    stop(): Promise<void> {
        return new Promise(resolve => {
            if(this.status === 'Stopped') {
                return resolve();
            };
            this.sendData("stop");
            this.status = "Stopping";
            // if(BServer.controls19132 == this) {
            //     BServer.is19132PortStarted = false;
            //     BServer.controls19132 = undefined;
            // }
    
            this.clobberAll();
            this.stopTimer = setTimeout(() => {
                this.proc.kill();
                this.status = "Stopped";
                this.clobberAll();
            }, 5000);
            this.queuedTasks.push(resolve);
        })
    }
    backupHold(): Promise<[string, number][]> {
        return new Promise(resolve => {
            this.sendData('save hold');
            this.queryInterval = setInterval(() => {
                this.sendData('save query');
            }, 500);
            this.sendData('save query');
            this.backupResolve = resolve;
        });
    }
    async recvData(data: string) {
        // if(this.description == 'A real genuine test of the software') console.log(data);
        if (data.includes("Running AutoCompaction..."))
            return;
        if(this.status === "Starting" && data.trim().endsWith("INFO] Server started."))  {
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
                await fs.mkdir(pathToWorldsFolder).catch(() => {});
                dirhandle = (await fs.readdir(pathToWorldsFolder, { withFileTypes: true }));
                dirhandle.filter(dir => dir.isDirectory()).forEach(dir => {
                    this.worlds[dir.name] = (new BWorld(this.id, dir.name, path.join(pathToWorldsFolder, dir.name)));
                });
                this.clobberWorld({ worlds: this.worlds });
                //.map(dir => new BWorld(this.id, dir.name, path.join(pathToWorldsFolder, dir.name)));
                
                // console.log(dirhandle);
                // this.worlds = dirhandle;
            } finally {

            }
            this.clobberAll();
        }
        else if(this.status === "Stopping" && data.endsWith("Quit correctly\n")) {
            // Stopped correctly, not doing anything with this info currently
        } else if(this.status == "Running" && data.includes("Player disconnected")) {
            this.onlinePlayers--;
        } else if (this.status == "Running" && data.includes("Player connected")) {
            const regex = /\[INFO\] Player connected: (\w+), xuid: (\d+)/.exec(data);
            const username = regex[1];
            const xuid = regex[2];
            if(!Player.xuidToPlayer.get(xuid)) {
                new Player(username, xuid, true);
            }
        } else if (this.status == "Running" && data.includes("Player disconnected")) {
            const regex = /\[INFO\] Player disconnected: (\w+), xuid: (\d+)/.exec(data);
            const username = regex[1];
            const xuid = regex[2];
            if(!Player.xuidToPlayer.get(xuid)) {
                new Player(username, xuid, true);
            }
        }
        // console.log(this.expectLine);
        this.expectLine.forEach(f => {
            // console.log("Calling f: " + f + " with data " + data);
            f(data);
        });
        this.expectLine = [];
        
        // Run backup
        if(data.includes("Data saved. Files are now ready to be copied.")) {
            clearInterval(this.queryInterval);
            // console.log("data: " + data);

            // Gathers the files and lengths
            const filedata = data.split("\n")[1];
            const filearr: string[] = filedata.split(", ");
            const dataarr = filearr.map(string => {
                const vals = /(.+):(\d+)/.exec(string);
                return [vals[1], parseInt(vals[2])];
            });
            if(this.backupResolve) {
                this.backupResolve(dataarr);
                this.backupResolve = undefined;
            }

            // Copy
            // dataarr.forEach(file => {
            //     copy()
            // })

            // Truncate
        }

        this.output += data;
        this.saveLog(data);
        for (let callback of (this.subscriptions.get('stdout') || [])) {
            callback(data, this.output);
        }
        
        this.clobberWorld({ consoleAppend: data });
    }
    commitPermissions() {
        let obj = [];
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
    sendData(data, suffix="\n") {
        this.proc.stdin.write(data + suffix);
        this.output += data + suffix;
        this.clobberWorld({ consoleAppend: data + suffix });
        this.saveLog("> " + data + suffix);
    }
    async saveLog(toAppend: string) {
        const pathToLog = path.join(this.path, 'logs', new Date().toDateString() + ".txt");
        // Make sure logs dir exists
        fs.mkdir(path.join(this.path, 'logs'), parseInt('0777', 8), err => {
            if (err && err.code != "EEXIST") throw err;
        });
        if(!toAppend) {
            fs.writeFile(pathToLog, this.output, err => {
                if (err) throw err
            });
            return;
        }
        // Write output to log file 
        fs.appendFile(pathToLog, toAppend, err => {
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
            onlinePlayers: this.onlinePlayers > 0 ? this.onlinePlayers : 0,
            'max-players': this.properties['max-players'] > 0 ? this.properties['max-players'] : 0,
            'server-port': this.properties['server-port'],
            status: this.status,
            access: userId ? this.getUserPermissionLevel(userId) : undefined,
            controls19132: this === BServer.controls19132,
            // 'level-name': this.properties['level-name'],
            description: this.description,
            'server-name': this.properties['server-name'] || this.properties['level-name'],
            currentWorld: this.currentWorld,
        };
    }
    static startQueuedServers() {
        BServer.isLaunched = true;
        BServer.queuedServers.forEach(server => {
            server.start();
        });
        BServer.queuedServers = [];
    }
    clobberWorld(data: serverUpdate) {
        data.id = this.id;
        Server.dataFromId.forEach(userdata => {
            if(!(this.getUserPermissionLevel(userdata.id) & LocalPermissions.CAN_VIEW)) return;
            const tmpData = Object.assign({}, data);
            if(!(this.getUserPermissionLevel(userdata.id) & LocalPermissions.CAN_EDIT_PERMISSIONS)) tmpData.allowedUsers = undefined;
            if(!(this.getUserPermissionLevel(userdata.id) & LocalPermissions.CAN_USE_CONSOLE)) tmpData.consoleAppend = undefined;
            
            if(userdata.selectedServer == this.id) {
                // console.log("Sending to user id " + userdata.id + " data " + data.status);
                userdata.socket.emit("serverUpdate", data);
            }
        })
    }
// #endregion
    sendAll(socket: Socket) {
        // Bad. Send only allowed data
        // Server.io.to("sId" + this.id).emit('fullServerSend', this);

        // Get the userId so we can test for permissions
        const userId = Server.idFromSocket.get(socket);
        const permLevel = this.getUserPermissionLevel(userId);

        // CAN_VIEW permission should already be checked, but check again to make sure
        if(!(permLevel & LocalPermissions.CAN_VIEW)) return;

        let allowedUsers2 = [];
        // Don't do allowedUsers inline because there are several steps
        if(permLevel & LocalPermissions.CAN_EDIT_PERMISSIONS) {
            // console.log("Server dataFromId: ", obj);
            const done = new Set();
            // Add specific permissions
            this.allowedUsers.forEach((val, key) => {
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
        }
        const props = Object.assign({}, this.properties);
        props['autostart'] = this.autostart
        // Make a new object to populate with required fields
        const serverData: fullServerSend = {
            id: this.id,
            description: this.description,
            status: this.status,
            version: this.version,
            onlinePlayers: this.onlinePlayers > 0 ? this.onlinePlayers : 0,
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
            currentWorld: this.currentWorld
        };
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
        }
        if(this.status == "Stopped") {
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
            this.properties["level-name"] = Object.getOwnPropertyNames(this.worlds).find(s => s !== name) || 'Bedrock level';
            this.properties.commit(path.join(this.path, 'server.properties'));
            this.currentWorld = this.properties["level-name"];
        }
        let success = await this.worlds[name].destroy();
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
            
        //     if(userdata.selectedServer == this.id) {
        //         // console.log("Sending to user id " + userdata.id + " data " + data.status);
        //         userdata.socket.emit("serverUpdate", data);
        //     }
        // })
        
        Server.dataFromId.forEach(async user => {
            if (this.getUserPermissionLevel(user.id) & LocalPermissions.CAN_VIEW) {
                if(user.socket) user.socket.emit('clobberAll', { server: await this.createSmallVersion(user.id) });
            }
        })
        // Server.io.emit('clobberAll', data);
    }
}
export class LocalPermissions extends ServerPermissions {
    static readonly CAN_VIEW             = 0b0000000001;
    static readonly CAN_USE_CONSOLE      = 0b0000000010;
    static readonly CAN_EDIT_PROPERTIES  = 0b0000000100;
    static readonly CAN_CREATE_WORLDS    = 0b0000001000;
    static readonly CAN_DELETE_WORLDS    = 0b0000010000;
    static readonly CAN_SET_STATUS       = 0b0000100000;
    static readonly CAN_EDIT_PERMISSIONS = 0b0001000000;
    static readonly IS_CREATOR_OF_SERVER = 0b0010000000;
}
// Map.prototype.inspect = function() {
//     return `Map(${mapEntriesToString(this.entries())})`
//   }
  
  function mapEntriesToString(entries) {
    return Array
      .from(entries, ([k, v]) => `\n  ${k}: ${v}`)
      .join("") + "\n";
  }