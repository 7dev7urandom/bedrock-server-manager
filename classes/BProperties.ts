const fs = require('fs');

export class BProperties  {
    // Defaults from the html file provided in the server zip by Mojang
    'level-type'?: string = 'DEFAULT';
    'gamemode': string = 'survival';
    'server-name': string = 'Dedicated Server';
    'difficulty': string = 'easy';
    'allow-cheats': boolean = false;
    'max-players': number = 10;
    'online-mode'?: boolean = true;
    'white-list'?: boolean = false;
    'server-port': number = 19132;
    'server-portv6': number = 19133;
    'view-distance'?: number = 10;
    'tick-distance'?: number = 4;
    'player-idle-timeout'?: number = 30;
    'max-threads'?: number = 8;
    'level-name'?: string = 'level';
    'default-player-permission-level'?: 'operator' | 'member' | 'visitor' = 'member';
    'texturepack-required'?: boolean = false;
    'content-log-file-enabled'?: boolean = false;
    'compression-threshold'?: number = 1;
    'server-authoritative-movement'?: boolean = true;
    'player-movement-score-threshold'?: number = 20;
    'player-movement-distance-threshold'?: number = 0.3;
    'player-movement-duration-threshold-in-ms'?: number = 500;
    'correct-player-movement'?: boolean = false;
    'level-seed'?: string = '';

    commit(path: string) {
        let data = '';
        for(let k in this) {
            if(!this.hasOwnProperty(k)) continue;
            data += k + "=" + this[k] + "\n";
        }
        
        return new Promise<void>((resolve, reject) => {
            fs.writeFile(path, data, err => {
                if(err) reject(err);
                else resolve();
            });
        })

    }
    constructor(self = {}) {
        Object.getOwnPropertyNames(self).forEach(name => {
            if(!isNaN(parseInt(self[name]))) this[name] = parseInt(self[name]);
            else if (self[name] == 'true' || self[name] == 'false') this[name] = (self[name] == 'true');
            else this[name] = self[name];
        });
        // console.log(JSON.stringify(this));
        this["server-name"] = this["server-name"].replace(/\n/g, "").trim();
        this["level-type"] = this["level-type"].replace(/\n/g, "").trim();
        this["gamemode"] = this["gamemode"].replace(/\n/g, "").trim();
        this["difficulty"] = this["difficulty"].replace(/\n/g, "").trim();
        this["level-name"] = this["level-name"].replace(/\n/g, "").trim();
        this["default-player-permission-level"] = <'operator' | 'member' | 'visitor'> this["default-player-permission-level"].replace(/\n/g, "").trim();
        this["server-name"] = this["server-name"].replace(/\n/g, "").trim();

    }
}