import BPermission from './BPermissions';
import { BProperties } from './BProperties';
import { BServer } from './BServer';

export class BDSXServer extends BServer {

    static wineName;
    static serverQueue: BDSXServer[] = [];
    type: string = "bdsx";

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
}