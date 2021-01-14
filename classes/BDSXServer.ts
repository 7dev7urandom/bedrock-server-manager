import { userIdNum, Server } from '../Server';
import BPermission from './BPermissions';
import { BProperties } from './BProperties';
import { BServer } from './BServer';
import DatabaseConnection from './DatabaseConnection';
import { wgetToFile } from '../localUtil';
import { config } from '../Constants';
const path = require('path');
import * as fs from 'fs-extra';
import * as unzipper from 'unzipper';
import * as request from 'request';


export class BDSXServer extends BServer {

    static wineName;
    static serverQueue: BDSXServer[] = [];
    static versionToBDSxVersion = new Map([['1.16.200.02', '1.3.48']]);
    type: 'bdsx' = "bdsx";

    constructor(id: number, desc: string, autostart: boolean, properties: BProperties, permissions: BPermission[], serverPath: string, version: string, allowedusers, env = {}, whitelist?: null) {
        super(id, desc, BDSXServer.wineName ? autostart : false, properties, permissions, serverPath, version, allowedusers, {
            'win32': [`bedrock_server.exe`],
            'linux': [BDSXServer.wineName, `bedrock_server.exe`]
        }[process.platform], process.platform === 'linux' ? Object.assign(env, { 'WINEDEBUG': "-all" }) : env, whitelist);
        if(!BDSXServer.wineName && autostart) {
            this.autostart = autostart;
            BDSXServer.serverQueue.push(this);
        }
    }
    static wineNameFound() {
        this.serverQueue.forEach(server => {
            server.start();
        });
    }
    static async createNew(name: string, desc: string, version: string, creatorId: userIdNum, progressBarId: string) {
        // FIXME: currently dies if version not in map
        if(!BDSXServer.versionToBDSxVersion.get(version)) return;
        let progresses: number[][] = [[0], [0, 0, 0], [0, 0, 0]];
        let text = "Loading...";
        // Get the socket for sending updates on creation progress. If there is no socket then our emits will do nothing but throw no error
        const socket = Server.dataFromId.get(creatorId).socket ? Server.dataFromId.get(creatorId).socket : { emit() {} };
        function updateProgress(textInput?: string, percent?: number) {
            console.log(progresses);
            if(textInput) {
                text = textInput;
            }
            if(percent) {
                socket.emit("progressBar", { id: progressBarId, text, progress: percent });
            }
            else {
                socket.emit("progressBar", { id: progressBarId, text, progress: Math.round(Math.min(progresses.reduce((old, cur) => old + (cur.reduce((old, cur) => old + cur, 0)), 0), 100))});
            }
        }
        const timeout = setInterval(updateProgress, 500);
        // Create bdsx server
        updateProgress("Starting...", 0);
        const allowedusers = {};
        allowedusers["" + creatorId] = 255;
        const id = await DatabaseConnection.insertQueryReturnId({
            text: "INSERT INTO servers (allowedusers, description, version, autostart, type) VALUES ($1, $2, $3, false, 'bdsx')",
            values: [JSON.stringify(allowedusers), desc, version]
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

        progresses[0] = [5];
        updateProgress("Downloading and unzipping files...");

        const BDSzipFilename = `bedrock-server-${version}.zip`

        // download and unzip bds
        const downloadProms = [];
        const unzipProms = [];
        if(!(await fs.pathExists(path.join(config.bdsDownloads, BDSzipFilename)))) {
            // const file = fs.createWriteStream(path.join(config.bdsDownloads, BDSzipFilename));
            // const req = https.get(`https://minecraft.azureedge.net/bin-win/${BDSzipFilename}`, res => res.pipe(file));
            console.log(`getting https://minecraft.azureedge.net/bin-win/${BDSzipFilename}`);
            downloadProms.push(wgetToFile(`https://minecraft.azureedge.net/bin-win/${BDSzipFilename}`, path.join(config.bdsDownloads, "win32-" + BDSzipFilename), (percent) => {
                progresses[1][0] = percent * 0.45;
            }));
            console.log("done");
        } else {
            downloadProms.push(new Promise<void>(r => r()));
            progresses[1][0] = 45;
        }
        
        downloadProms[0].then(() => {
            const stream = fs.createReadStream(path.join(config.bdsDownloads, "win32-" + BDSzipFilename));
            let length = Infinity;
            let currentLength = 0;
            fs.stat(path.join(config.bdsDownloads, "win32-" + BDSzipFilename)).then(stat => length = stat.size);
            stream.on('data', (chunk) => {
                currentLength += chunk.length
                progresses[2][0] = currentLength / length * 10;
            });
            unzipProms.push(stream.pipe(unzipper.Extract({ path: sPath })));
        });
        // download and unzip element minus
        if(!(await fs.pathExists(path.join(config.bdsDownloads, 'eminus.zip')))) {
            console.log(`getting https://github.com/karikera/elementminus/releases/download/1.0.6/eminus.zip`);
            downloadProms.push(wgetToFile(`https://github.com/karikera/elementminus/releases/download/1.0.6/eminus.zip`, path.join(config.bdsDownloads, 'eminus.zip'), (percent) => {
                progresses[1][1] = percent * 0.15;
            }));
            console.log("done");
        } else {
            downloadProms.push(new Promise<void>(r => r()));
            progresses[1][1] = 15;
        }
        // we have the file cached
        downloadProms[1].then(() => {
            const stream = fs.createReadStream(path.join(config.bdsDownloads, 'eminus.zip'));
            let length = Infinity;
            let currentLength = 0;
            fs.stat(path.join(config.bdsDownloads, 'eminus.zip')).then(stat => {
                length = stat.size;
                progresses[2][1] = currentLength / length * 7;
            });
            stream.on('data', (chunk) => {
                currentLength += chunk.length;
                progresses[2][1] = currentLength / length * 7;
            });
            unzipProms.push(stream.pipe(unzipper.Extract({ path: sPath })));
        });
        // fs.createReadStream(path.join(config.bdsDownloads, 'eminus.zip')).pipe(unzipper.Extract({ path: sPath }));
        // download and unzip bdsx
        await fs.ensureDir(path.join(sPath, 'mods'));
        const bdsxversion = BDSXServer.versionToBDSxVersion.get(version);
        const bdsxfilename = `bdsx-bin-${bdsxversion}.zip`;
        if(!(await fs.pathExists(path.join(config.bdsDownloads, bdsxfilename)))) {
            // @ts-ignore
            const directory = await unzipper.Open.url(request,`https://github.com/karikera/bdsx/releases/download/1.3.48/bdsx-${bdsxversion}-win.zip`);
            const file = directory.files.find(d => d.path === 'bdsx/node_modules/bdsx/bdsx-bin.zip');
            const fileh = fs.createWriteStream(path.join(config.bdsDownloads, bdsxfilename));
            const thething = file.stream();
            // console.log("BDSx zip size: " + file.compressedSize);
            const length = file.compressedSize;
            let currentLength = 0;
            thething.pipe(fileh);
            thething.on('data', (chunk) => {
                currentLength += chunk.length;
                progresses[1][2] = currentLength / length * 15;
            });
            downloadProms.push(new Promise<void>(r => {
                fileh.on('finish', async () => {
                    await fileh.close();
                    r();
                })
            }));
        } else {
            downloadProms.push(new Promise<void>(r => r()));
            progresses[1][2] = 15;
        }
        // bdsx downloaded
        downloadProms[2].then(() => {
            const stream = fs.createReadStream(path.join(config.bdsDownloads, bdsxfilename));
            let length = Infinity;
            fs.stat(path.join(config.bdsDownloads, bdsxfilename)).then(stat => length = stat.size);
            let currentLength = 0;
            stream.on('data', (chunk) => {
                currentLength += chunk.length;
                progresses[2][2] = currentLength / length * 8;
            });
            unzipProms.push(stream.pipe(unzipper.Extract({ path: path.join(sPath, 'mods') })).promise());
        });
        await Promise.all(downloadProms);
        await Promise.all(unzipProms);
        progresses.push([100]);
        updateProgress("Creating server...", 100);
        clearInterval(timeout);
        const serverObj = new BDSXServer(id, desc, false, new BProperties(), [], sPath, version, allowedusers);
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
}