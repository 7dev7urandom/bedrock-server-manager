import Player from "./Player";

interface BPermission {
    player: Player;
    permission: 'operator' | 'member' | 'visitor' | 'default';
}

export default BPermission;
