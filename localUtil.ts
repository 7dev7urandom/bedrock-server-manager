import { BProperties } from "./classes/BProperties";
import BPermission from "./classes/BPermissions";
import { parse } from 'dotenv';
import { readFile, createWriteStream } from 'fs-extra';
import { promisify } from 'util';
import Player from "./classes/Player";
import request = require("request");

const readFileAsync = promisify(readFile);

export async function propertiesFileToBProperties(filePath): Promise<BProperties> {
    //@ts-ignore
    return new BProperties(parse(await readFileAsync(filePath)));
}

export async function permissionsFileToBPermissions(filePath): Promise<BPermission[]> {
    let filedata;
    try {
        filedata = (await readFileAsync(filePath)).toString();
    } catch (e) {
        return [];
    }
    let json = JSON.parse(filedata);
    if(!Array.isArray(json)) json = [];
    return json.map(e => { 
        return { 
            player: Player.xuidToPlayer.get(e.xuid) ?? { xuid: e.xuid },
            permission: e.permission 
        }
    });
}

export async function wgetToFile(url, filepath, progressCallback?) {
    return new Promise<void>((resolve, reject)=>{
        const file = createWriteStream(filepath);
        const req = request.get(url);
        req.pipe(file).on('error', (err) => {
            console.error(`Error getting url ${url}: ${err}`);
        });
        let length;
        let currentLength = 0;
        req.on('response', (data) => {
            length = data.headers['content-length'];
        })
        req.on('data', (chunk) => {
            currentLength += chunk.length;
            if(progressCallback) progressCallback(currentLength * 100 / length);
            // console.log("Data: " + chunk.length / length);
        })
        file.on('finish', async () => {
            await file.close();
            resolve();
        });
    });
}