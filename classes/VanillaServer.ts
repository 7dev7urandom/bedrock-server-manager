import BPermission from './BPermissions';
import { BProperties } from './BProperties';
import { BServer } from './BServer';
export class VanillaServer extends BServer {

    type = "vanilla";
    constructor(id: number, desc: string, autostart: boolean, properties: BProperties, permissions: BPermission[], serverPath: string, version: string, allowedusers, whitelist?: null) {
        super(id, desc, autostart, properties, permissions, serverPath, version, allowedusers, {
            'win32': `(cd ${serverPath} & bedrock_server.exe)`,
            'linux': `cd ${serverPath} && LD_LIBRARY_PATH=. ./bedrock_server`
        }[process.platform], whitelist);
    }
}