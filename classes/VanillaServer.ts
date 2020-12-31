const path = require('path');
import { config } from '../Constants';
import { wgetToFile } from '../localUtil';
import BPermission from './BPermissions';
import { BProperties } from './BProperties';
import { BServer } from './BServer';
import DatabaseConnection from './DatabaseConnection';
import * as fs from 'fs-extra';
import { Server, userIdNum } from '../Server';
import * as unzipper from 'unzipper';

export class VanillaServer extends BServer {

    type: 'vanilla' = "vanilla";
    constructor(id: number, desc: string, autostart: boolean, properties: BProperties, permissions: BPermission[], serverPath: string, version: string, allowedusers, env = {}, whitelist?: null) {
        super(id, desc, autostart, properties, permissions, serverPath, version, allowedusers, {
            'win32': `bedrock_server.exe`,
            'linux': `bedrock_server`
        }[process.platform], process.platform === 'linux' ? Object.assign(env, { 'LD_LIBRARY_PATH': "." }) : env, whitelist);
    }
    static async createNew(name: string, desc: string, version: string, creatorId: userIdNum, progressBarId: string) {
        let progresses: number[][] = [[0], [0], [0]];
        let text = "Loading...";
        const socket = Server.dataFromId.get(creatorId).socket ? Server.dataFromId.get(creatorId).socket : { emit() {} };
        function updateProgress(textInput?: string, percent?: number) {
            if(textInput) {
                text = textInput;
                console.log(text);
            }
            if(percent) {
                socket.emit("progressBar", { id: progressBarId, text, progress: percent });
            }
            else {
                socket.emit("progressBar", {
                    id: progressBarId, 
                    text, 
                    progress: Math.round(Math.min(
                            progresses.reduce((old, cur) => 
                                old + (cur.reduce((old, cur) => old + cur, 0) / cur.length),
                            0),
                            100
                        ))
                });
            }
        }
        const timeout = setInterval(updateProgress, 500);
        updateProgress("Starting...", 0);
        const allowedusers = {};
        allowedusers["" + creatorId] = 255;
        const id = await DatabaseConnection.insertQueryReturnId({
            text: "INSERT INTO servers (allowedusers, description, version, autostart, type) VALUES ($1, $2, $3, false, 'vanilla')",
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
        updateProgress("Downloading files...");

        const BDSzipFilename = `bedrock-server-${version}.zip`

        // download and unzip bds

        if(!(await fs.pathExists(path.join(config.bdsDownloads, BDSzipFilename)))) {
            console.log(`getting https://minecraft.azureedge.net/bin-win/${BDSzipFilename}`);
            await (wgetToFile(`https://minecraft.azureedge.net/bin-win/${BDSzipFilename}`, path.join(config.bdsDownloads, BDSzipFilename), (percent) => {
                progresses[1][0] = percent * 0.7;
            }));
            console.log("done");
        } else {
            progresses[1][0] = 70;
        }
        updateProgress("Unzipping files...");
        const stream = fs.createReadStream(path.join(config.bdsDownloads, BDSzipFilename));
        let length = Infinity;
        let currentLength = 0;
        fs.stat(path.join(config.bdsDownloads, BDSzipFilename)).then(stat => length = stat.size);
        stream.on('data', data => {
            currentLength += data.length;
            progresses[2][0] = currentLength / length * 25;
        });
        await stream.pipe(unzipper.Extract({ path: sPath })).promise();
        updateProgress("Creating server...", 100);
        clearInterval(timeout);
        const serverObj = new VanillaServer(id, desc, false, new BProperties(), [], sPath, version, allowedusers);
        serverObj.properties['server-name'] = name;
        await serverObj.properties.commit(path.join(serverObj.path, 'server.properties'));
        socket.emit("progressBarFinished", { id: progressBarId });
        return serverObj;
    }
    updateCommand() {
        this.command = {
            'win32': `(cd ${this.path} & bedrock_server.exe)`,
            'linux': `cd ${this.path} && LD_LIBRARY_PATH=. ./bedrock_server`
        }[process.platform];
    }
}