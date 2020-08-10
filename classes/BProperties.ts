export interface BProperties  {
    levelType?: string;
    gamemode: string;
    serverName: string;
    difficulty: string;
    allowCheats: boolean;
    maxPlayers: number;
    _onlineMode?: boolean;
    whitelist?: boolean;
    port: number;
    port6: number;
    _viewDistance?: number;
    tickDistance?: number;
    playerIdleTimeout?: number;
    _maxThreads?: number;
    _levelName?: string;
    _$defaultPlayerPermissionLevel?: string;
    _texturepackRequired?: boolean;
    contentLogFileEnabled?: boolean;
    _compressionThreshold?: number;
    _serverAuthoritativeMovement?: boolean;
    _playerMovementScoreThreshold?: number;
    _playerMovementDistanceThreshold?: number;
    _playerMovementDurationThresholdInMs?: number;
    _correctPlayerMovement?: boolean;
    _$levelSeed?: string;
}