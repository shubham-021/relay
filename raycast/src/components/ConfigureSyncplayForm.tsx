import {
  Action,
  ActionPanel,
  Form,
  Icon,
  showToast,
  Toast,
  useNavigation,
} from "@raycast/api";
import { useEffect, useState } from "react";
import { resolveSyncplayExecutable, validatePlayerPath } from "../player";
import {
  getPlayerConfig,
  getSyncplayConfig,
  saveSyncplayConfig,
} from "../preferences";
import type { SyncplayConfig } from "../types";

interface ConfigureSyncplayFormProps {
  onConfigured?: (config: SyncplayConfig) => void | Promise<void>;
}

export function ConfigureSyncplayForm({
  onConfigured,
}: ConfigureSyncplayFormProps) {
  const { pop } = useNavigation();

  const [server, setServer] = useState("");
  const [username, setUsername] = useState("");
  const [room, setRoom] = useState("");
  const [password, setPassword] = useState("");
  const [playerPath, setPlayerPath] = useState("");
  const [pickedPlayer, setPickedPlayer] = useState<string[]>([]);
  const [syncplayPath, setSyncplayPath] = useState("");
  const [pickedSyncplay, setPickedSyncplay] = useState<string[]>([]);

  const [serverError, setServerError] = useState<string | undefined>();
  const [usernameError, setUsernameError] = useState<string | undefined>();
  const [roomError, setRoomError] = useState<string | undefined>();
  const [playerError, setPlayerError] = useState<string | undefined>();
  const [syncplayError, setSyncplayError] = useState<string | undefined>();
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    Promise.all([getSyncplayConfig(), getPlayerConfig()]).then(
      ([syncCfg, playerCfg]) => {
        setServer(syncCfg.server || "syncplay.pl:8999");
        setUsername(syncCfg.username || "");
        setRoom(syncCfg.room || "");
        setPassword(syncCfg.password || "");
        setPlayerPath(syncCfg.playerPath || playerCfg.playerPath || "");
        setSyncplayPath(syncCfg.syncplayPath || "");
        setIsLoaded(true);
      },
    );
  }, []);

  async function handleSubmit() {
    let hasError = false;

    const trimmedServer = server.trim();
    if (!trimmedServer) {
      setServerError("Server address is required (e.g. syncplay.pl:8999)");
      hasError = true;
    }

    const trimmedUsername = username.trim();
    if (!trimmedUsername) {
      setUsernameError("Username is required");
      hasError = true;
    }

    const trimmedRoom = room.trim();
    if (!trimmedRoom) {
      setRoomError("Room name is required");
      hasError = true;
    }

    const candidatePlayer = playerPath.trim() || pickedPlayer[0] || "";
    if (candidatePlayer) {
      const checkPlayer = validatePlayerPath(candidatePlayer);
      if (!checkPlayer.valid) {
        setPlayerError(checkPlayer.error);
        hasError = true;
      }
    }

    const candidateSyncplay = syncplayPath.trim() || pickedSyncplay[0] || "";
    if (candidateSyncplay) {
      const resolvedExec = resolveSyncplayExecutable(candidateSyncplay);
      const checkSyncplay = validatePlayerPath(resolvedExec);
      if (!checkSyncplay.valid && candidateSyncplay !== "syncplay") {
        setSyncplayError(checkSyncplay.error);
        hasError = true;
      }
    }

    if (hasError) return;

    const nextConfig: SyncplayConfig = {
      server: trimmedServer,
      username: trimmedUsername,
      room: trimmedRoom,
      password: password.trim() || undefined,
      playerPath: candidatePlayer
        ? validatePlayerPath(candidatePlayer).resolved
        : undefined,
      syncplayPath: candidateSyncplay
        ? resolveSyncplayExecutable(candidateSyncplay)
        : "/Applications/Syncplay.app/Contents/MacOS/Syncplay",
    };

    await saveSyncplayConfig(nextConfig);
    await showToast({
      style: Toast.Style.Success,
      title: "Syncplay configured",
      message: `Room: ${nextConfig.room} on ${nextConfig.server}`,
    });

    pop();
    if (onConfigured) {
      await onConfigured(nextConfig);
    }
  }

  return (
    <Form
      isLoading={!isLoaded}
      navigationTitle="Configure Syncplay"
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Save Syncplay Configuration"
            icon={Icon.Check}
            onSubmit={handleSubmit}
          />
        </ActionPanel>
      }
    >
      <Form.TextField
        id="server"
        title="Server Address"
        placeholder="syncplay.pl:8999"
        value={server}
        error={serverError}
        autoFocus
        onChange={(val) => {
          setServer(val);
          if (serverError) setServerError(undefined);
        }}
        info="Syncplay server host:port (e.g. syncplay.pl:8999 or your private syncplay server)"
      />

      <Form.TextField
        id="room"
        title="Room Name"
        placeholder="movie-night"
        value={room}
        error={roomError}
        onChange={(val) => {
          setRoom(val);
          if (roomError) setRoomError(undefined);
        }}
        info="Name of the room for you and your friends to join"
      />

      <Form.TextField
        id="username"
        title="Username"
        placeholder="shubham"
        value={username}
        error={usernameError}
        onChange={(val) => {
          setUsername(val);
          if (usernameError) setUsernameError(undefined);
        }}
        info="Your display nickname inside the room"
      />

      <Form.PasswordField
        id="password"
        title="Room Password (Optional)"
        placeholder="Leave empty if none"
        value={password}
        onChange={setPassword}
        info="Optional room password if your syncplay room is password-protected"
      />

      <Form.Separator />

      <Form.TextField
        id="playerPath"
        title="Player Binary for Syncplay"
        placeholder="/opt/homebrew/bin/mpv"
        value={playerPath}
        error={playerError}
        onChange={(val) => {
          setPlayerPath(val);
          if (playerError) setPlayerError(undefined);
        }}
        info="Path to the media player CLI binary (e.g. mpv or VLC). Defaults to your configured Relay player."
      />

      <Form.FilePicker
        id="playerPicker"
        title="Or Browse for Player Binary"
        allowMultipleSelection={false}
        canChooseFiles
        canChooseDirectories={false}
        value={pickedPlayer}
        onChange={(paths) => {
          setPickedPlayer(paths);
          if (paths[0]) {
            setPlayerPath(paths[0]);
            if (playerError) setPlayerError(undefined);
          }
        }}
      />

      <Form.Separator />

      <Form.TextField
        id="syncplayPath"
        title="Syncplay Executable Path"
        placeholder="/Applications/Syncplay.app/Contents/MacOS/Syncplay"
        value={syncplayPath}
        error={syncplayError}
        onChange={(val) => {
          setSyncplayPath(val);
          if (syncplayError) setSyncplayError(undefined);
        }}
        info="Path to Syncplay.app or the syncplay executable binary"
      />

      <Form.FilePicker
        id="syncplayPicker"
        title="Or Browse for Syncplay"
        allowMultipleSelection={false}
        canChooseFiles
        canChooseDirectories
        value={pickedSyncplay}
        onChange={(paths) => {
          setPickedSyncplay(paths);
          if (paths[0]) {
            setSyncplayPath(paths[0]);
            if (syncplayError) setSyncplayError(undefined);
          }
        }}
      />
    </Form>
  );
}
