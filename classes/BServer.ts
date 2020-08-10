import { BWorld } from "./BWorld";
import { BPermissions } from './BPermissions';
import { BProperties } from './BProperties';
import { ChildProcess, exec } from "child_process";
import DatabaseConnection from "./DatabaseConnection";
import { Socket } from "socket.io";
import { Server, GlobalPermissions } from '../Server'
import { ServerPermissions, System } from '../Constants';
const fs = require('fs');
const path = require('path');

export class ServerNotFoundError extends Error {

}

interface MinimalBServer {
    id: number;
    version: string;
    onlinePlayers: number;
    maxPlayers: number;
    access: number;
    port: number;
    status: string;
    controls19132: boolean;
    name: string;
    description: string;
}

export class BServer {
    static is19132PortStarted: boolean = false;
    static queuedServers: BServer[] = [];
    properties: BProperties | null;
    id: number;
    permissions: BPermissions | null;
    worlds: BWorld[] | null;
    version: string;
    whitelist: null;
    onlinePlayers: number;
    maxPlayers: number;
    port: number;
    output: string;
    proc: ChildProcess;
    path: string;
    status: string;
    subscriptions: Map<string, CallableFunction[]>;
    allowedUsers: Map<number, number> = new Map<number, number>();
    autostart: boolean;
    name: string;
    description: string;
    static controls19132: BServer | null = null;
    dataFetched: boolean = false;

    constructor(id: number, name: string, desc: string, autostart: boolean, properties: BProperties, permissions: BPermissions, worlds: BWorld[], version: string, whitelist?: null) {
        this.properties = properties;
        this.id = id;
        this.permissions = permissions;
        this.worlds = worlds;
        this.version = version;
        this.whitelist = whitelist;
        this.status = "Stopped";
        this.autostart = autostart;
        this.name = name;
        this.description = desc;
        if(this.autostart) this.start();
    }
    async getData() {
        const result = await DatabaseConnection.query({
            // rowMode: 'array',
            text: 'SELECT * FROM servers WHERE id=$1',
            values: [this.id]
        });
        // console.log(result);
        if(result.rows.length < 1)
            throw new ServerNotFoundError("Server with id " + this.id + " was not found in the database");
        this.path = result.rows[0].path;
        // TODO
        if(this.worlds == null) {
            result.rows[0].worldids.forEach(worldId => {
                this.worlds.push(new BWorld(worldId));
            });
        }
        for (let user in result.rows[0].allowedusers) {
            // console.log(result.rows[0].user);
            this.allowedUsers.set(parseInt(user), result.rows[0].allowedusers[user]);
        }
        // this.name = result[0].name;
        // this.description = result[0].description;
        this.dataFetched = true;
    }
    getUserPermissionLevel(user: number) {
        // console.log(mapEntriesToString(this.allowedUsers));
        return this.allowedUsers.get(user) || 0;
    }
    async start() {
        await this.getData();
        if(!BServer.is19132PortStarted && this.port !== 19132 && !System.isLaunched) {
            BServer.queuedServers.push(this);
            return;
        }
        if(!BServer.is19132PortStarted) {
            BServer.is19132PortStarted = true;
            BServer.controls19132 = this;
        }
        this.status = "Starting";
        this.proc = exec(`(cd ${this.path}; LD_LIBRARY_PATH=. ./bedrock_server)`);
        this.proc.stderr.on('data', data => console.error("I have literally no idea what to do right now. The server gave an error message: " + data.toString()));
        this.proc.stdout.on('data', data => {
            data = data.toString();
            if(this.status === "Starting" && data.endsWith(" INFO] Server started.\n")) 
                this.status = "Running";
            else if(this.status === "Stopping" && data.endsWith("Quit correctly\n"))
                this.status = "Stopped";
            this.output += data;
            this.saveLog(data);
            for (let callback of this.subscriptions.get('stdout')) {
                callback(data, this.output);
            }
        });
        this.proc.on('exit', code => {
            if(code != 0) console.error("I have literally no idea what to do right now. The server exited with an error code " + code);
        });
        if(BServer.is19132PortStarted && BServer.controls19132 === this) {
            BServer.startQueuedServers();
        }
    }
    stop() {
        this.sendData("stop");
        this.status = "Stopping";
        if(BServer.controls19132 == this) BServer.is19132PortStarted = false;
    }
    sendData(data, suffix="\n") {
        this.proc.stdin.write(data + suffix);
    }
    async saveLog(toAppend: string) {
        const pathToLog = path.join(this.path, 'logs', new Date().toUTCString());
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
            if (err) throw err
        });
    }
    subscribe(event: string, callback: CallableFunction) {
        let arr = this.subscriptions.get(event);
        arr = arr ? arr : [];
        arr.push(callback);
        this.subscriptions.set(event, arr);
    }
    async createSmallVersion(userId: number | Socket): Promise<MinimalBServer> {
        if (typeof(userId) !== "number") userId = Server.idFromSocket.get(userId);
        if (
            !(this.allowedUsers.get(userId) & LocalPermissions.CAN_SEE_STATUS)
            && !(Server.dataFromId.get(userId).globalPermissions & GlobalPermissions.CAN_OVERRIDE_LOCAL)
        ) 
            return;
        if(!this.dataFetched)
            await this.getData();
        return {
            id: this.id,
            version: this.version,
            onlinePlayers: this.onlinePlayers > 0 ? this.onlinePlayers : 0,
            maxPlayers: this.properties.maxPlayers > 0 ? this.properties.maxPlayers : 0,
            port: this.properties.port,
            status: this.status,
            access: this.getUserPermissionLevel(userId),
            controls19132: this === BServer.controls19132,
            name: this.name,
            description: this.description
        };
    }
    static startQueuedServers() {
        BServer.queuedServers.forEach(server => {
            server.start();
        })
    }
}

export class LocalPermissions extends ServerPermissions {
    static readonly CAN_VIEW             = 0b0000000001;
    static readonly CAN_USE_CONSOLE      = 0b0000000010;
    static readonly CAN_EDIT_PROPERTIES  = 0b0000000100;
    static readonly CAN_CREATE_WORLDS    = 0b0000001000;
    static readonly CAN_DELETE_WORLDS    = 0b0000010000;
    static readonly CAN_SEE_STATUS       = 0b0000100000;
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