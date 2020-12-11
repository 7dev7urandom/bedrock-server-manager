import Player from "./Player";

export default interface BPermission {
    player: Player;
    permission: 'operator' | 'member' | 'visitor' | 'default';
}