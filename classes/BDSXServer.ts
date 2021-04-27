import { userIdNum, Server } from '../Server';
import { BServer, LocalPermissions } from './BServer';
import DatabaseConnection from './DatabaseConnection';
import { wgetToFile } from '../localUtil';
import { config } from '../Constants';
const path = require('path');
import * as fs from 'fs-extra';
import * as unzipper from 'unzipper';
import { ChildProcess, exec } from 'child_process';
import { spawn } from 'node-pty';
import { ServerProcess } from './ServerProcess';
import { scripts, serverUpdate } from '../packetDef';
import * as socketio from 'socket.io';
import { servers } from '..';
import Player from './Player';

// export const BDSXVERSION = '1.16.201.02';
// export const BDSXCOREVERSION = '1.0.1.0';

export interface BDSXServerUpdate extends serverUpdate {
    scriptingTabs?: ScriptingTab[];
}

interface ScriptingTab {
    name: string;
    properties: ScriptingTabValue[];
}

interface ScriptingTabValue {
    type: string;
    value: any;
    name: string;
    id: string;
}
interface BooleanScriptingTabValue extends ScriptingTabValue {
    type: "boolean";
    value: boolean;
}
interface StringScriptingTabValue extends ScriptingTabValue {
    type: "string";
    value: string;
}
interface NumberScriptingTabValue extends ScriptingTabValue {
    type: "number";
    value: number;
}

export class BDSXServer extends BServer {

    static wineName;
    static serverQueue: BDSXServer[] = [];
    static io: socketio.Server;
    type: 'bdsx' = "bdsx";
    mainPath: string;
    scripts: scripts = {};
    isConnectedToProcSocket: boolean = false;
    extraScriptingTabs: ScriptingTab[] = [];
    socket: socketio.Socket;

    constructor(id: number, desc: string, autostart: boolean, serverPath: string, version: string, allowedusers, env = {}, whitelist?: null) {
        super(id, desc, BDSXServer.wineName ? autostart : false, path.join(serverPath, 'bedrock_server'), version, allowedusers, whitelist);
        BDSXServer.startServer();
        this.mainPath = serverPath;
        (async () => {
            await fs.ensureFile(path.join(this.mainPath, 'scriptInfo.json'));
            // || not ?? because empty string should be considered falsey
            this.scripts = JSON.parse((await fs.readFile(path.join(this.mainPath, 'scriptInfo.json'))).toString() || 'null') ?? {
                uploadedTime: false
            };
        })();
        if(!BDSXServer.wineName && autostart) {
            this.autostart = autostart;
            BDSXServer.serverQueue.push(this);
        }
    }
    static startServer() {
        if(!config.bdsxServerListener || this.io) return;

        this.io = socketio(config.bdsxServerListener);
        this.io.on('connection', (socket) => {
            socket.emit("ready", { version: "1.0" });
            socket.on("sessionId", (sessionId) => {
                if(!sessionId) {
                    console.warn(`Invalid connection to BDSX server listener session id ${JSON.stringify(sessionId)}`);
                    return;
                }
                const server = Array.from(servers.values()).find(server => server.sessionId === sessionId) as BDSXServer;
                server.initializeSocket(socket);
            });
        });
    }
    initializeSocket(socket: SocketIO.Socket) {
        this.isConnectedToProcSocket = true;
        this.socket = socket;
        socket.on("registerTabs", ({ tabs }) => {
            this.extraScriptingTabs = tabs;
            this.clobberWorld({ scriptingTabs: this.extraScriptingTabs });
        });
        socket.on("changeSetting", ({ tab, id, value }) => {
            this.extraScriptingTabs
                .find(tabName => tabName.name === tab).properties
                .find(prop => prop.id === id).value = value;
            this.clobberWorld({ scriptingTabs: this.extraScriptingTabs });
        });
        socket.on("getPlayers", () => {
          socket.emit("playerList", Array.from(Player.nameToPlayer.keys()));
        });
        socket.on('disconnect', () => {
            this.extraScriptingTabs = [];
            this.clobberWorld({ scriptingTabs: [] });
            this.isConnectedToProcSocket = false;
        });
    }
    spawn() {
        const env = Object.assign({}, process.env);
        env.NODE_OPTIONS = undefined;
        if(process.platform == 'win32') {
            const proc = exec(`bedrock_server.exe ..`, {
                cwd: this.path,
                env
            });
            return new ServerProcess(proc);
        } else if (process.platform == 'linux') {
            env.WINEDEBUG = "-all";
            // IPty spawn
            return new ServerProcess(spawn(BDSXServer.wineName, [`bedrock_server.exe`, `..`], {
                cwd: this.path,
                env,
                cols: 200
            }));
        }
    }
    clobberWorld(data: BDSXServerUpdate) {
        if(data.scriptingTabs && !(LocalPermissions.CAN_EDIT_PROPERTIES)) data.scriptingTabs = undefined;
        super.clobberWorld(data);
    }
    sendAll(socket: SocketIO.Socket, additionalData: any = {}) {
        super.sendAll(socket, Object.assign(additionalData, { scriptingTabs: this.extraScriptingTabs }));
    }
    
    static wineNameFound() {
        this.serverQueue.forEach(server => {
            server.start();
        });
    }
    static async createNew(name: string, desc: string, creatorId: userIdNum, progressBarId: string) {
        let text = "Loading...";
        let currentProg = 0;
        // Get the socket for sending updates on creation progress. If there is no socket then our emits will do nothing but throw no error
        const socket = Server.dataFromId.get(creatorId).socket ? Server.dataFromId.get(creatorId).socket : { emit() {} };
        function updateProgress(textInput?: string, percent?: number) {
            if(textInput) {
                text = textInput;
            }
            if(percent) {
                if(currentProg !== percent) socket.emit("progressBar", { id: progressBarId, text, progress: Math.floor(percent) });
                currentProg = percent;
            }
            else {
                // socket.emit("progressBar", { id: progressBarId, text, progress: Math.round(Math.min(progresses.reduce((old, cur) => old + (cur.reduce((old, cur) => old + cur, 0)), 0), 100))});
            }
        }
        // const timeout = setInterval(updateProgress, 500);
        // Create bdsx server
        updateProgress("Starting...", 0);
        const allowedusers = {};
        allowedusers["" + creatorId] = 255;
        const id = await DatabaseConnection.insertQueryReturnId({
            text: "INSERT INTO servers (allowedusers, description, version, autostart, type) VALUES ($1, $2, $3, false, 'bdsx')",
            values: [JSON.stringify(allowedusers), desc, 'bdsx']
        });
        // console.log("Creating");
        // console.log(JSON.stringify(res));
        let sPath = path.join(config.basePath, 'servers', `sid`);

        let suffix = id;

        while(await fs.pathExists(sPath + suffix)) {
            suffix = suffix + " 2";
        }
        sPath += suffix;
        await Promise.all([fs.ensureDir(sPath), fs.ensureDir(config.bdsDownloads)]);
        
        DatabaseConnection.query({
            text: "UPDATE servers SET path = $1 WHERE id = $2",
            values: [sPath, id]
        });
        updateProgress("Downloading...", 10);
        function execInDirProm(command, env?): Promise<void> {
            return new Promise((r) => {
                const proc: ChildProcess = exec(command, { cwd: sPath, env });
                proc.on('close', r);
            });
        }
        // downloads/bdsx/
        // await ((): Promise<void> => {
        //     return new Promise(async (r) => {
        //         if(await fs.pathExists(path.join(config.bdsDownloads, 'bdsx'))) {
        //             // BDSX 2.0 is already downloaded, update
        //             updateProgress("Updating...", 25);
        //             exec(`git pull`, {
        //                 cwd: path.join(config.bdsDownloads, 'bdsx')
        //             }).on('close', r);
        //         } else {
        //             // Need to clone bdsx
        //             exec(`git clone https://github.com/bdsx/bdsx bdsx`, {
        //                 cwd: path.join(config.bdsDownloads)
        //             }).on('close', async () => {
        //                 await fs.emptyDir(path.join(config.bdsDownloads, 'bdsx', 'example_and_test'));
        //                 r();
        //             });
        //         }
        //     });
        // })();
        await execInDirProm(`git clone https://github.com/bdsx/bdsx .`);
        // await fs.move(path.join(sPath, 'example_and_test'), path.join(sPath, 'examples'));
        // await fs.createFile(path.join(sPath, 'example_and_test', 'index.ts'));
        await fs.writeFile(path.join(sPath, 'index.ts'), "console.log('BSM injection loaded');");
        updateProgress("Installing...", 80);
        await execInDirProm(`npm i`);
        // updateProgress("Downloading BDS...", 40);
        // // await execInDirProm(`node ./bdsx/installer ./bedrock_server -y`);
        const version = JSON.parse((await fs.readFile(path.join(sPath, 'bdsx', 'version-bds.json'))).toString());
        // const BDSXCOREVERSION = JSON.parse((await fs.readFile(path.join(sPath, 'bdsx', 'version-bdsx.json'))).toString());
        // {
        //     // Install BDS
        //     await fs.ensureDir(path.join(sPath, 'bedrock_server'));
        //     const zipPath = path.join(config.bdsDownloads, `win32-bedrock-server-${version}.zip`);
        //     if(!(await fs.pathExists(zipPath)))
        //         await wgetToFile(`https://minecraft.azureedge.net/bin-win/bedrock-server-${version}.zip`, zipPath, (percent) => {
        //             updateProgress("Downloading BDS...", 40 + (percent * 0.15));
        //         });
        //     updateProgress("Installing BDS...", 55);
        //     const stream = fs.createReadStream(zipPath);
        //     let length = Infinity;
        //     let currentLength = 0;
        //     fs.stat(zipPath).then(stat => length = stat.size);
        //     stream.on('data', data => {
        //         currentLength += data.length;
        //         updateProgress("Installing BDS...", 55 + (10 * currentLength / length));
        //     });
        //     await stream.pipe(unzipper.Extract({ path: path.join(sPath, 'bedrock_server') })).promise();
        // }
        // {
        //     // Install BDSXCore
        //     const zipPath = path.join(config.bdsDownloads, `bdsx-core.zip`);
        //     if(!(await fs.pathExists(zipPath)))
        //         await wgetToFile(`https://github.com/bdsx/bdsx-core/releases/download/${BDSXCOREVERSION}/bdsx-core-${BDSXCOREVERSION}.zip`, zipPath, (percent) => {
        //             updateProgress("Downloading BDSX Core...", 65 + (percent * 0.15));
        //         });
        //     updateProgress("Installing BDSX Core...", 80);
        //     const stream = fs.createReadStream(zipPath);
        //     let length = Infinity;
        //     let currentLength = 0;
        //     fs.stat(zipPath).then(stat => length = stat.size);
        //     stream.on('data', data => {
        //         currentLength += data.length;
        //         updateProgress("Installing BDSX Core...", 80 + (10 * currentLength / length));
        //     });
        //     await stream.pipe(unzipper.Extract({ path: path.join(sPath, 'bedrock_server') })).promise();
        // }
        updateProgress("Building code...", 95);
        await execInDirProm(`npm run -s build`);
        updateProgress("Finished! Importing new server...", 100);
        const serverObj = new BDSXServer(id, desc, false, sPath, version, allowedusers);
        await new Promise(r => serverObj.prepQuery.push(r));
        serverObj.properties['server-name'] = name;
        await serverObj.properties.commit(path.join(serverObj.path, 'server.properties'));
        socket.emit("progressBarFinished", { id: progressBarId });
        return serverObj;
    }
    updateCommand() {
        this.command = {
            'win32': `(cd ${this.path} & bedrock_server.exe)`,
            'linux': `cd ${this.path} && WINEDEBUG=-all ${BDSXServer.wineName} bedrock_server.exe`
        }[process.platform]
    }
    async addPlugin(repo: string, name?: string): Promise<boolean> {
        let pluginPath = path.join(this.mainPath, 'plugins', name ?? '.tmp');
        try {
            await fs.mkdir(pluginPath);
        } catch {
            return false;
        }
        await new Promise((r) => {
            const proc: ChildProcess = exec(`git clone ${repo} .`, { cwd: pluginPath });
            proc.on('close', r);
        });
        if((await fs.readdir(pluginPath)).length) return false;
        if(!name) {
            // Get the name from package.json
            const json = JSON.parse((await fs.readFile(path.join(pluginPath, 'package.json'))).toString());
            name = json.name;
            pluginPath = path.join(this.mainPath, 'plugins', name.replace("@bdsx/", ""));
            if(!/@bdsx\//.test(name) || fs.pathExists(pluginPath)) {
                await fs.remove(path.join(this.mainPath, 'plugins', '.tmp'));
                return false;
            }
        }
        return true;
    }
    async addPluginAsZip(filepath: string) {
        throw new Error('Function not implemented');
    }
    async addPublicPlugin(pluginName: string): Promise<boolean> {
        if(!/@bdsx\//.test(pluginName)) {
            // TODO: send error message
            return false;
        }
        await this.execInDirProm(`npm i "${pluginName}"`);
        return true;
    }
    async execInDirProm(command, env?): Promise<void> {
        return new Promise((r) => {
            const proc: ChildProcess = exec(command, { cwd: this.mainPath, env });
            proc.on('close', r);
        });
    }
    async updatePlugin(pluginName: string) {
        return new Promise((r) => {
            const proc: ChildProcess = exec(`git pull`, { cwd: path.join(this.mainPath, 'plugins', pluginName) });
            proc.on('close', r);
        });
    }
    /**
     * @deprecated We use plugins now instead of scripts. Upload a path to a git repo or a zip file of the plugin instead. Issue #2 on GitHub
     * 
     * @param filepath the path to the zip
     * @param socket the user that performed the action
     */
    async uploadScriptZip(filepath: string, socket: SocketIO.Socket) {
        await fs.emptyDir(path.join(this.mainPath, 'example_and_test'));
        await (await unzipper.Open.file(filepath)).extract({
            path: path.join(this.mainPath, 'example_and_test')
        });
        exec(`npm run build`, {
            cwd: this.mainPath
        });
        socket.emit(`scriptZipUploaded`);
        this.scripts.uploadedAuthor = Server.dataFromId.get(Server.idFromSocket.get(socket)).username;
        this.scripts.uploadedTime = Date.now();
        this.scripts.repo = undefined;
        fs.writeFile(path.join(this.mainPath, 'scriptInfo.json'), JSON.stringify(this.scripts));
        this.clobberWorld({
            scripts: this.scripts
        });
    }
    /**
     * @deprecated We use plugins now instead of scripts. Issue #2 on GitHub
     * 
     * @param socket the user that performed the action
     * @param isNew do we need to clone or pull?
     */
    async updateGitRepoScripts(socket: SocketIO.Socket, isNew: boolean) {
        if(!this.scripts.repo) return;
        if (isNew) await fs.emptyDir(path.join(this.mainPath, 'example_and_test'));
        if(!await fs.pathExists(path.join(this.mainPath, 'example_and_test', '.git'))) {
            await (new Promise(r => exec(`git clone ${this.scripts.repo} example_and_test`, {
                cwd: this.mainPath
            }).on('close', x => r(x))));
        } else {
            await (new Promise(r => exec(`git pull`, {
                cwd: path.join(this.mainPath, 'example_and_test')
            }).on('close', x => r(x))));
        }
        exec(`npm run build`, {
            cwd: this.mainPath
        });
        this.scripts.uploadedTime = Date.now();
        this.scripts.uploadedAuthor = Server.dataFromId.get(Server.idFromSocket.get(socket)).username;

        fs.writeFile(path.join(this.mainPath, 'scriptInfo.json'), JSON.stringify(this.scripts));
        this.clobberWorld({
            scripts: this.scripts
        });
    }
    specials() {
        return {
            scripts: this.scripts
        }
    }
}