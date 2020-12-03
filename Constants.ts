// export class System {
//     static isLaunched: boolean = false;
// }
export class ServerPermissions {
    static has(who, what) : boolean {
        return (who & what) !== 0
    }
}
export const NO_PERMISSION_ERROR = "You don't have permission to do that";