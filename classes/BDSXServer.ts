import { userIdNum, Server, GlobalPermissions } from '../Server';
import { BServer } from './BServer';
import DatabaseConnection from './DatabaseConnection';
import { config } from '../Constants';
const path = require('path');
import * as fs from 'fs-extra';
import * as unzipper from 'unzipper';
import { ChildProcess, exec } from 'child_process';
import { spawn } from 'node-pty';
import { ServerProcess } from './ServerProcess';
import { serverUpdate } from '../packetDef';
import * as socketio from 'socket.io';
import Player from './Player';
import { Socket } from 'socket.io';

export interface BDSXServerUpdate extends serverUpdate {
    scriptingTabs?: ScriptingTab[];
    plugins?: BDSXPlugin[];
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
// interface BooleanScriptingTabValue extends ScriptingTabValue {
//     type: "boolean";
//     value: boolean;
// }
// interface StringScriptingTabValue extends ScriptingTabValue {
//     type: "string";
//     value: string;
// }
// interface NumberScriptingTabValue extends ScriptingTabValue {
//     type: "number";
//     value: number;
// }

export interface BDSXPlugin {
    name: string;
    repo: string | "Public npm package" | null;
    dateEdited: Date | string;
}

export class BDSXServer extends BServer {

    static wineName;
    static serverQueue: BDSXServer[] = [];
    static io: socketio.Server;
    // status: 'Stopped' | 'Running' | 'Starting' | 'Stopping';
    isUpdating: boolean = false;
    type: 'bdsx' = "bdsx";
    mainPath: string;
    isConnectedToProcSocket: boolean = false;
    extraScriptingTabs: ScriptingTab[] = [];
    socket: socketio.Socket;
    plugins: BDSXPlugin[] = [];

    constructor(id: number, desc: string, autostart: boolean, serverPath: string, version: string, allowedusers, env = {}, whitelist?: null) {
        super(id, desc, BDSXServer.wineName ? autostart : false, path.join(serverPath, 'bedrock_server'), version, allowedusers, whitelist);
        BDSXServer.startServer();
        this.mainPath = serverPath;
        // Deprecated. Was for scripts, now plugins are used instead
        // (async () => {
            //     await fs.ensureFile(path.join(this.mainPath, 'scriptInfo.json'));
            //     // || not ?? because empty string should be considered falsey
            //     this.scripts = JSON.parse((await fs.readFile(path.join(this.mainPath, 'scriptInfo.json'))).toString() || 'null') ?? {
                //         uploadedTime: false
                //     };
                // })();
        Server.fileListeners.set(this.id, this.addPluginAsZip);
        (async () => {
            if(this.version === 'bdsx') {
                fs.readJSON(path.join(this.mainPath, 'bdsx', 'version-bds.json')).then(x => {
                    this.version = x;
                    DatabaseConnection.query({
                        text: "UPDATE servers SET version = $1 WHERE id = $2",
                        values: [this.version, this.id]
                    });
                });

            }
            try {
                const filearr = await fs.readdir(path.join(this.mainPath, 'plugins'), {
                    withFileTypes: true
                });
                for(const data of filearr) {
                    // const isDirectory = data.isDirectory;
                    const pluginName = data.name;
                    // console.log(isDirectory);
                    // const x = isDirectory();
                    // console.log("test");
                    if(data.isFile() || data.isFIFO()) continue;
                    const [{ ctime: creationTime }, repoUrl] = await Promise.all([
                        fs.stat(path.join(this.mainPath, 'plugins', pluginName, '.git', 'FETCH_HEAD')),
                        new Promise((r: (url: string) => void) => {
                            exec('git config --get remote.origin.url', { cwd: path.join(this.mainPath, 'plugins', pluginName), env }, (err, out) => {
                                if(err) throw err;
                                r(out);
                            });
                        })
                    ]);
                    this.plugins.push({
                        dateEdited: creationTime,
                        repo: repoUrl,
                        name: pluginName
                    });
                }
            } catch (e) {
                // console.log(e);
            }
            try {
                const packagejson = await fs.readJson(path.join(this.mainPath, 'package.json'));
                for(const pluginName in packagejson.dependencies) {
                    if(!pluginName.startsWith("@bdsx/") || this.plugins.find(x => x.name === pluginName.replace("@bdsx/", ""))) return;
                    this.plugins.push({
                        dateEdited: packagejson.dependencies[pluginName],
                        repo: "Public npm package",
                        name: pluginName.substring("@bdsx/".length)
                    });
                }
            } catch {}
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
                const server = Array.from(BServer.servers.values()).find(server => server.sessionId === sessionId) as BDSXServer;
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
        if(process.platform === 'win32') {
            const proc = exec(`bedrock_server.exe ..`, {
                cwd: this.path,
                env
            });
            return new ServerProcess(proc);
        } else if (process.platform === 'linux') {
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
        // if(data.scriptingTabs && !(LocalPermissions.CAN_EDIT_PROPERTIES)) data.scriptingTabs = undefined;
        // if(data.plugins && !(LocalPermissions.CAN_EDIT_PROPERTIES))
        super.clobberWorld(data);
    }
    sendAll(socket: SocketIO.Socket, additionalData: any = {}) {
        super.sendAll(socket, Object.assign(additionalData, Server.dataFromId.get(Server.idFromSocket.get(socket)).globalPermissions & GlobalPermissions.CAN_MANAGE_SCRIPTS ? {
            scriptingTabs: this.extraScriptingTabs,
            plugins: this.plugins,
            isUpdating: this.isUpdating
        } : {}));
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
        // eslint-disable-next-line @typescript-eslint/no-empty-function
        const socket = Server.dataFromId.get(creatorId).socket ? Server.dataFromId.get(creatorId).socket : { emit() {} };
        function updateProgress(textInput?: string, percent?: number) {
            if(textInput) {
                text = textInput;
            }
            if(percent) {
                if(currentProg !== percent) socket.emit("progressBar", { id: progressBarId, text, progress: Math.floor(percent) });
                currentProg = percent;
            } else {
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
        }[process.platform];
    }
    async update() {
        if(this.status !== 'Stopped') return;
        this.isUpdating = true;
        this.clobberAll();
        await this.execInDirProm(`git pull`);
        try {
            this.version = await fs.readJSON(path.join(this.mainPath, 'bdsx', 'version-bds.json'));
        } catch (e) {
            // console.log(e);
            if(e.code !== 'ENOENT') {
                this.isUpdating = false;
                return;
            }
        }
        DatabaseConnection.query({
            text: "UPDATE servers SET version = $1 WHERE id = $2",
            values: [this.version, this.id]
        });
        await this.execInDirProm(`npm i`);
        await this.execInDirProm(`npm run build`);
        this.isUpdating = false;
        this.clobberAll();
    }
    async createSmallVersion(userId?: number | Socket) {
        const data = await super.createSmallVersion(userId);
        (data as any).isUpdating = this.isUpdating;
        return data;
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
        if(!(await fs.readdir(pluginPath)).length) {
            await fs.remove(pluginPath);
            return false;
        }
        if(!name) {
            // Get the name from package.json
            let json;
            try {
                json = JSON.parse((await fs.readFile(path.join(pluginPath, 'package.json'))).toString());
            } catch {
                await fs.remove(path.join(this.mainPath, 'plugins', '.tmp'));
                return false;
            }
            name = json.name;
            pluginPath = path.join(this.mainPath, 'plugins', name.replace("@bdsx/", ""));
            if(!/@bdsx\//.test(name) || await fs.pathExists(pluginPath)) {
                await fs.remove(path.join(this.mainPath, 'plugins', '.tmp'));
                return false;
            }
            await fs.move(path.join(this.mainPath, 'plugins', '.tmp'), pluginPath);
        }
        if(name.startsWith("@bdsx/")) name = name.replace("@bdsx/", "");
        this.plugins.push({
            name,
            dateEdited: new Date(),
            repo
        });
        this.clobberWorld({
            plugins: this.plugins
        });
        return true;
    }
    async addPluginAsZip(filepath: string): Promise<boolean> {
        const tmpDir = path.join(this.mainPath, 'plugins', '.tmp');
        fs.mkdir(tmpDir);
        await (await unzipper.Open.file(filepath)).extract({
            path: tmpDir
        });
        let name;
        try {
            name = JSON.parse((await fs.readFile(path.join(tmpDir, 'package.json'))).toString()).name;
        } catch {
            await fs.remove(tmpDir);
            return false;
        }
        const pluginDir = path.join(this.mainPath, 'plugins', name.replace("@bdsx/", ""));
        if(!/@bdsx\//.test(name) || fs.pathExists(pluginDir)) {
            await fs.remove(path.join(this.mainPath, 'plugins', '.tmp'));
            return false;
        }
        await fs.move(path.join(this.mainPath, 'plugins', '.tmp'), pluginDir);
        this.plugins.push({
            name: name.replace("@bdsx/", ""),
            dateEdited: new Date(),
            repo: null
        });
        this.clobberWorld({
            plugins: this.plugins
        });
        return true;
    }
    async addPublicPlugin(pluginName: string): Promise<boolean> {
        if(!BDSXServer.checkNpmName(pluginName, true)) return false;
        await this.execInDirProm(`npm i ${pluginName}`);
        const json = await fs.readJson(path.join(this.mainPath, 'package.json'));
        let date: Date | string = new Date();
        try {
            date = json.dependencies[pluginName];
        } catch {}
        if(!date) return false;
        this.plugins.push({
            name: pluginName.replace("@bdsx/", ""),
            dateEdited: date,
            repo: "Public npm package"
        });
        this.clobberWorld({
            plugins: this.plugins
        });
        return true;
    }
    async removePlugin(pluginName: string) {
        const plugin = this.plugins.findIndex(x => x.name === pluginName);
        if(!this.plugins[plugin]) return;
        if(!BDSXServer.checkNpmName(pluginName)) return;
        if(this.plugins[plugin].repo === 'Public npm package') {
            await this.execInDirProm(`npm uninstall @bdsx/${pluginName}`);
        } else {
            // zips and git repos are removed the same way
            await fs.remove(path.join(this.mainPath, 'plugins', pluginName));
        }
        this.plugins.splice(plugin, 1);
        this.clobberWorld({
            plugins: this.plugins
        });
    }
    async execInDirProm(command, env?): Promise<void> {
        return new Promise((r) => {
            const proc: ChildProcess = exec(command, { cwd: this.mainPath, env });
            proc.on('close', r);
        });
    }
    async updatePlugin(pluginName: string) {
        const plugin = this.plugins.find(x => x.name === pluginName);
        if(!plugin) return;
        if(!BDSXServer.checkNpmName(pluginName)) return;
        if(plugin.repo === 'Public npm package') {
            await this.execInDirProm(`npm install @bdsx/${pluginName}@latest`);
            try {
                const json = await fs.readJson(path.join(this.mainPath, 'package.json'));
                if(json.dependencies["@bdsx/" + pluginName]) {
                    plugin.dateEdited = json.dependencies["@bdsx" + pluginName];
                }
            } catch (e) {
                console.trace("Ignoring error reading package.json file. ID=" + this.id);
            }
            return;
        }
        if(plugin.repo) {
            console.log(await new Promise((r) => {
                const proc: ChildProcess = exec(`git pull`, { cwd: path.join(this.mainPath, 'plugins', pluginName) });
                proc.on('close', r);
            }));
            plugin.dateEdited = new Date();
        }
        this.clobberWorld({
            plugins: this.plugins
        });
    }
    static checkNpmName(name: string, withScope = false) {
        return withScope ? /^@bdsx\/[a-z-]*$/.test(name) : /^[a-z-]*$/.test(name);
    }
}
if(process.platform === 'win32') {
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
