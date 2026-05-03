interface Window {
  electronAPI: {
    openFile(): Promise<string | null>;
    sendAction(cmd: 'play' | 'pause' | 'seek', mediaTimeMs: number): Promise<void>;
    getPing(): Promise<number | null>;
    onRemoteAction(cb: (data: RemoteAction) => void): () => void;
    onMqttStatus(cb: (status: string) => void): () => void;
  };
}

interface RemoteAction {
  action: boolean | null; // true=play, false=pause, null=seek
  media_time: number;     // ms
  ping: number;           // sender's one-way latency ms
  sender: string;
}
