import { Color, Icon, List, showToast, Toast } from "@raycast/api";
import { useCallback, useEffect, useState } from "react";
import { getCachedArray, getOtherFiles } from "../api";
import type { OtherFileItem } from "../types";
import { PlayableActionPanel } from "./MediaActions";

interface OtherFilesListProps {
  onLoggedOut?: () => void | Promise<void>;
}

export function buildOtherFileAccessories(
  file: OtherFileItem,
): List.Item.Accessory[] {
  const accessories: List.Item.Accessory[] = [];
  if (file.completed) {
    accessories.push({
      tag: { value: "Watched", color: Color.Green },
      icon: Icon.CheckCircle,
    });
  } else if (file.percent > 0) {
    accessories.push({ tag: { value: `${file.percent}%`, color: Color.Blue } });
  }
  accessories.push({ text: file.sizeFormatted });
  return accessories;
}

export function OtherFilesList({ onLoggedOut }: OtherFilesListProps) {
  const [files, setFiles] = useState<OtherFileItem[]>(
    () => getCachedArray<OtherFileItem>("other"),
  );
  const [isLoading, setIsLoading] = useState(true);

  const load = useCallback(async () => {
    setIsLoading(true);
    try {
      const items = await getOtherFiles();
      setFiles(Array.isArray(items) ? items : []);
    } catch (err) {
      await showToast({
        style: Toast.Style.Failure,
        title: "Failed to load other files",
        message: err instanceof Error ? err.message : String(err),
      });
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  return (
    <List
      isLoading={isLoading}
      navigationTitle="Other Files"
      searchBarPlaceholder="Search other files..."
    >
      {(Array.isArray(files) ? files : []).map((file) => (
        <List.Item
          key={`${file.account_id}-${file.torrent_id}-${file.file_id}`}
          title={file.short_name || file.filename}
          subtitle={file.remote_path || file.mime_type}
          icon={Icon.Document}
          keywords={[file.filename, file.remote_path, file.mime_type].filter(
            Boolean,
          )}
          accessories={buildOtherFileAccessories(file)}
          actions={
            <PlayableActionPanel
              target={{
                account_id: file.account_id,
                torrent_id: file.torrent_id,
                file_id: file.file_id,
                title: file.short_name || file.filename,
              }}
              completed={file.completed}
              onRefresh={load}
              onLoggedOut={onLoggedOut}
            />
          }
        />
      ))}
    </List>
  );
}
