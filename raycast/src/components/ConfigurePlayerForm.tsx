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
import { getPlayerConfig, savePlayerConfig } from "../preferences";
import { validatePlayerPath } from "../player";
import type { PlayerConfig } from "../types";

interface ConfigurePlayerFormProps {
  onConfigured?: (config: PlayerConfig) => void | Promise<void>;
}

export function ConfigurePlayerForm({
  onConfigured,
}: ConfigurePlayerFormProps) {
  const { pop } = useNavigation();
  const [playerPath, setPlayerPath] = useState("");
  const [pickedFiles, setPickedFiles] = useState<string[]>([]);
  const [playerArgs, setPlayerArgs] = useState("");
  const [resumePlayback, setResumePlayback] = useState(true);
  const [pathError, setPathError] = useState<string | undefined>();
  const [isLoaded, setIsLoaded] = useState(false);

  useEffect(() => {
    getPlayerConfig().then((cfg) => {
      setPlayerPath(cfg.playerPath);
      setPlayerArgs(cfg.playerArgs);
      setResumePlayback(cfg.resumePlayback);
      setIsLoaded(true);
    });
  }, []);

  async function handleSubmit() {
    const candidatePath = playerPath.trim() || pickedFiles[0] || "";
    const check = validatePlayerPath(candidatePath);
    if (!check.valid) {
      setPathError(check.error);
      return;
    }

    const nextConfig: PlayerConfig = {
      playerPath: check.resolved,
      playerArgs: playerArgs.trim(),
      resumePlayback,
    };

    await savePlayerConfig(nextConfig);
    await showToast({
      style: Toast.Style.Success,
      title: "Player configured",
      message: check.resolved,
    });

    pop();
    if (onConfigured) {
      await onConfigured(nextConfig);
    }
  }

  return (
    <Form
      isLoading={!isLoaded}
      navigationTitle="Configure Relay Player"
      actions={
        <ActionPanel>
          <Action.SubmitForm
            title="Save Player"
            icon={Icon.Check}
            onSubmit={handleSubmit}
          />
        </ActionPanel>
      }
    >
      <Form.TextField
        id="playerPath"
        title="Player Binary or App Path"
        placeholder="/Applications/IINA.app or /opt/homebrew/bin/mpv"
        value={playerPath}
        error={pathError}
        autoFocus
        onChange={(value) => {
          setPlayerPath(value);
          if (pathError) setPathError(undefined);
        }}
        info="Paste the full path to your player binary (e.g. mpv, iina-cli, VLC) or .app bundle."
      />

      <Form.FilePicker
        id="playerPicker"
        title="Or Browse for Player"
        allowMultipleSelection={false}
        canChooseFiles
        canChooseDirectories
        value={pickedFiles}
        onChange={(paths) => {
          setPickedFiles(paths);
          if (paths[0]) {
            setPlayerPath(paths[0]);
            if (pathError) setPathError(undefined);
          }
        }}
      />

      <Form.TextField
        id="playerArgs"
        title="Extra Arguments (Optional)"
        placeholder="--fullscreen"
        value={playerArgs}
        onChange={setPlayerArgs}
        info="Optional CLI flags. Include {url} if your player expects the URL in a specific position."
      />

      <Form.Checkbox
        id="resumePlayback"
        label="Resume from saved Relay watch position"
        value={resumePlayback}
        onChange={setResumePlayback}
        info="Supported when launching mpv, iina-cli, or vlc binaries directly."
      />

      <Form.Separator />

      <Form.Description
        title="Common macOS Paths"
        text={[
          "• IINA (app): /Applications/IINA.app",
          "• IINA (CLI with resume): /Applications/IINA.app/Contents/MacOS/iina-cli",
          "• mpv (Homebrew): /opt/homebrew/bin/mpv",
          "• VLC (app): /Applications/VLC.app",
          "• VLC (CLI with resume): /Applications/VLC.app/Contents/MacOS/VLC",
        ].join("\n")}
      />
    </Form>
  );
}
