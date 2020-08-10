export class System {
    static isLaunched: boolean = false;
}
export class ServerPermissions {
    static has(who, what) : boolean {
        return (who & what) !== 0
    }
}