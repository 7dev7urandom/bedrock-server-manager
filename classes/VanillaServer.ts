const path = require('path');
import { config, wgetToFile } from '../index';
import BPermission from './BPermissions';
import { BProperties } from './BProperties';
import { BServer } from './BServer';
import DatabaseConnection from './DatabaseConnection';
import * as fs from 'fs-extra';
import { userIdNum } from '../Server';
import * as unzipper from 'unzipper';

export class VanillaServer extends BServer {

    type: 'vanilla' = "vanilla";
    constructor(id: number, desc: string, autostart: boolean, properties: BProperties, permissions: BPermission[], serverPath: string, version: string, allowedusers, whitelist?: null) {
        super(id, desc, autostart, properties, permissions, serverPath, version, allowedusers, {
            'win32': `(cd ${serverPath} & bedrock_server.exe)`,
            'linux': `cd ${serverPath} && LD_LIBRARY_PATH=. ./bedrock_server`
        }[process.platform], whitelist);
    }
    static async createNew(name: string, desc: string, version: string, creatorId: userIdNum) {
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

        if(!(await fs.pathExists(path.join(config.bdsDownloads, BDSzipFilename)))) {
            console.log(`getting https://minecraft.azureedge.net/bin-win/${BDSzipFilename}`);
            await (wgetToFile(`https://minecraft.azureedge.net/bin-win/${BDSzipFilename}`, path.join(config.bdsDownloads, BDSzipFilename)));
            console.log("done");
        }
        
        await fs.createReadStream(path.join(config.bdsDownloads, BDSzipFilename)).pipe(unzipper.Extract({ path: sPath }));
        const serverObj = new VanillaServer(id, desc, false, new BProperties(), [], sPath, version, allowedusers);
        serverObj.properties['server-name'] = name;
        await serverObj.properties.commit(path.join(serverObj.path, 'server.properties'));
        return serverObj;
    }
}