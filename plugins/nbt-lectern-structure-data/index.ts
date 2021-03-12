import { parse, writeUncompressed } from 'prismarine-nbt';
import { join } from 'path';
import { readFile, createWriteStream } from 'fs-extra'
import PluginSystem from '../../classes/Plugins';

PluginSystem.onServerStopped(async server => {
    if(await new Promise(async r => {
        const datapath = join(server.path, 'pagesdata.json');
        let success = true;
        const file = await readFile(datapath).catch(x => success = false);
        if(!success) return r(false);
        const data = JSON.parse(file.toString() || 'null');
        data.forEach(async structure => {
            const path = join(server.path, 'behavior_packs', 'brain', 'structures', `lectern${structure.id}.mcstructure`);
        
            const { parsed, type } = await parse(await readFile(path), 'little');
            //@ts-ignore
            parsed.value.structure.value.palette.value.default.value.block_position_data.value["0"]
                .value.block_entity_data.value.book.value.tag.value.pages.value.value = structure.pages.map(x => {
                return {
                    "photoname":{"type":"string","value":""},
                    "text":{
                        "type":"string",
                        "value":x
                    }
                }
            });;
            const outBuffer = createWriteStream(path);
            const newBuf = writeUncompressed(parsed, type);
            outBuffer.write(newBuf);
            outBuffer.end(() => r(true));
        });
    })) server.start();
});

