import { remove } from 'fs-extra';
export class BWorld {
    serverId: number;
    name: string;
    path: string;
    generated: boolean;


    constructor(serverId, name, path, generated = true) {
        this.serverId = serverId;
        this.name = name;
        this.path = path;
        this.generated = generated;
    }
    // Destroys the world in the fs. Doesn't handle everything.
    async destroy(): Promise<boolean> {
        try {
            await remove(this.path);
        } catch (e) {
            console.error("Error removing world " + this.name + " in server id " + this.serverId + ". Error: " + e.message);
            return false;
        }
        return true;
    }
}
