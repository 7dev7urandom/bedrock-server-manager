import { userIdNum } from '../Server';
import BPermission from './BPermissions';
import { BProperties } from './BProperties';
import { BServer } from './BServer';
import DatabaseConnection from './DatabaseConnection';
import { config, wgetToFile } from '../index';
const path = require('path');
import * as fs from 'fs-extra';
import * as unzipper from 'unzipper';
import * as request from 'request';

export class BDSXServer extends BServer {

    static wineName;
    static serverQueue: BDSXServer[] = [];
    type: 'bdsx' = "bdsx";

    constructor(id: number, desc: string, autostart: boolean, properties: BProperties, permissions: BPermission[], serverPath: string, version: string, allowedusers, whitelist?: null) {
        super(id, desc, BDSXServer.wineName ? autostart : false, properties, permissions, serverPath, version, allowedusers, {
            'win32': `(cd ${serverPath} & bedrock_server.exe)`,
            'linux': `cd ${serverPath} && WINEDEBUG=-all ${BDSXServer.wineName} bedrock_server.exe`
        }[process.platform], whitelist);
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
    static async createNew(name: string, desc: string, version: string, creatorId: userIdNum) {
// FIXME: currently gets set versions of eminus and bdsx rather than querying the most recent version

        // Create bdsx server
        const allowedusers = {};
        allowedusers["" + creatorId] = 255;
        const id = await DatabaseConnection.insertQueryReturnId({
            text: "INSERT INTO servers (allowedusers, description, version, autostart, type) VALUES ($1, $2, $3, true, 'bdsx')",
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
        const BDSzipFilename = `bedrock-server-${version}.zip`

        // download and unzip bds
        const downloadProms = [];
        const unzipProms = [];
        if(!(await fs.pathExists(path.join(config.bdsDownloads, BDSzipFilename)))) {
            // const file = fs.createWriteStream(path.join(config.bdsDownloads, BDSzipFilename));
            // const req = https.get(`https://minecraft.azureedge.net/bin-win/${BDSzipFilename}`, res => res.pipe(file));
            console.log(`getting https://minecraft.azureedge.net/bin-win/${BDSzipFilename}`);
            downloadProms.push(wgetToFile(`https://minecraft.azureedge.net/bin-win/${BDSzipFilename}`, path.join(config.bdsDownloads, BDSzipFilename)));
            console.log("done");
        } else 
            downloadProms.push(new Promise<void>(r => r()));
        
        downloadProms[0].then(() => {
            unzipProms.push(fs.createReadStream(path.join(config.bdsDownloads, BDSzipFilename)).pipe(unzipper.Extract({ path: sPath })));
        });
        // download and unzip element minus
        if(!(await fs.pathExists(path.join(config.bdsDownloads, 'eminus.zip')))) {
            console.log(`getting https://github.com/karikera/elementminus/releases/download/1.0.6/eminus.zip`);
            downloadProms.push(wgetToFile(`https://github.com/karikera/elementminus/releases/download/1.0.6/eminus.zip`, path.join(config.bdsDownloads, 'eminus.zip')));
            console.log("done");
        } else 
            downloadProms.push(new Promise<void>(r => r()));
        // we have the file cached
        downloadProms[1].then(() => {
            unzipProms.push(fs.createReadStream(path.join(config.bdsDownloads, 'eminus.zip')).pipe(unzipper.Extract({ path: sPath })));
        });
        // fs.createReadStream(path.join(config.bdsDownloads, 'eminus.zip')).pipe(unzipper.Extract({ path: sPath }));
        // download and unzip bdsx
        await fs.ensureDir(path.join(sPath, 'mods'));

        if(!(await fs.pathExists(path.join(config.bdsDownloads, 'bdsx-bin.zip')))) {
            // @ts-ignore
            const directory = await unzipper.Open.url(request,'https://github.com/karikera/bdsx/releases/download/1.3.48/bdsx-1.3.48-win.zip');
            const file = directory.files.find(d => d.path === 'bdsx/node_modules/bdsx/bdsx-bin.zip');
            const fileh = fs.createWriteStream(path.join(config.bdsDownloads, 'bdsx-bin.zip'));
            file.stream().pipe(fileh);
            downloadProms.push(new Promise<void>(r => {
                fileh.on('finish', async () => {
                    await fileh.close();
                    r();
                })
            }));
        } else 
            downloadProms.push(new Promise<void>(r => r()));
        // bdsx downloaded
        downloadProms[2].then(() => {
            unzipProms.push(fs.createReadStream(path.join(config.bdsDownloads, 'bdsx-bin.zip')).pipe(unzipper.Extract({ path: path.join(sPath, 'mods') })).promise());
        });
        await Promise.all(downloadProms);
        await Promise.all(unzipProms);
        const serverObj = new BDSXServer(id, desc, false, new BProperties(), [], sPath, version, allowedusers);
        serverObj.properties['server-name'] = name;
        await serverObj.properties.commit(path.join(serverObj.path, 'server.properties'));
        return serverObj;
    }
    
}