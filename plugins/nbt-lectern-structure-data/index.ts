import { parse, writeUncompressed } from 'prismarine-nbt';
import { join } from 'path';
import { readFile, createWriteStream, copyFile, pathExists, remove } from 'fs-extra'
import PluginSystem from '../../classes/Plugins';
PluginSystem.onServerStopped(async server => {
    if(await new Promise(async r => {
        const datapath = join(server.path, 'pagesdata.json');
        console.log('test');
        let restart = await pathExists(join(server.path, 'restart.tmp'));
        remove(join(server.path, 'restart.tmp'));
        console.log('test2');

        console.log(restart);
        let success = true;
        const file = await readFile(datapath).catch(() => success = false);
        if(!success) return r(restart);
        const data = JSON.parse(file.toString() || 'null');
        const proms = [];
        new Map<string, string[][]>(Object.entries(data)).forEach((structure, id) => {
            structure.forEach(async (thing, index) => {

                const path = join(server.path, 'behavior_packs', 'brain', 'structures', `lectern${id}${index}.mcstructure`);
                await copyFile(join(server.path, 'behavior_packs', 'brain', 'structures', `lectern.mcstructure`), path);
                const { parsed, type } = await parse(await readFile(path), 'little');
                //@ts-ignore
                parsed.value.structure.value.palette.value.default.value.block_position_data.value["0"]
                    .value.block_entity_data.value.book.value.tag.value.pages.value.value = thing.map(x => {
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
                proms.push(new Promise(done => outBuffer.end(done)));
            })
        });
        await Promise.all(proms);
        r(restart);
    })) server.start();
});

