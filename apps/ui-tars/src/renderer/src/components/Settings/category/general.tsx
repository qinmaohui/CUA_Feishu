import { useState } from 'react';
import { Button } from '@renderer/components/ui/button';
import { RefreshCcw } from 'lucide-react';
import { api } from '@/renderer/src/api';
import { toast } from 'sonner';
import { useSetting } from '@renderer/hooks/useSetting';
import { Switch } from '@renderer/components/ui/switch';

import { REPO_OWNER, REPO_NAME } from '@main/shared/constants';

export const GeneralSettings = () => {
  const { settings, updateSetting } = useSetting();
  const [updateLoading, setUpdateLoading] = useState(false);
  const [updateDetail, setUpdateDetail] = useState<{
    currentVersion: string;
    version: string;
    link: string | null;
  } | null>();

  const handleCheckForUpdates = async () => {
    setUpdateLoading(true);
    try {
      const detail = await api.checkForUpdatesDetail();
      console.log('detail', detail);

      if (detail.updateInfo) {
        setUpdateDetail({
          currentVersion: detail.currentVersion,
          version: detail.updateInfo.version,
          link: `https://github.com/${REPO_OWNER}/${REPO_NAME}/releases/tag/v${detail.updateInfo.version}`,
        });
        return;
      } else if (!detail.isPackaged) {
        toast.info('Unpackaged version does not support update check!');
      } else {
        toast.success('No update available', {
          description: `current version: ${detail.currentVersion} is the latest version`,
          position: 'top-right',
          richColors: true,
        });
      }
    } catch (error) {
      console.error('Failed to check for updates:', error);
    } finally {
      setUpdateLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between rounded-lg border p-3">
        <div className="pr-4">
          <div className="text-sm font-medium">Recording Friendly Widget</div>
          <div className="text-sm text-muted-foreground">
            Show the Widget in screen recordings. When enabled, screenshots hide
            it briefly; when disabled, the Widget is protected from recordings
            and screenshots.
          </div>
        </div>
        <Switch
          checked={!!settings.recordingFriendlyWidget}
          onCheckedChange={(checked) =>
            updateSetting({
              ...settings,
              recordingFriendlyWidget: checked,
            })
          }
        />
      </div>
      <Button
        variant="outline"
        type="button"
        disabled={updateLoading}
        onClick={handleCheckForUpdates}
      >
        <RefreshCcw
          className={`h-4 w-4 mr-2 ${updateLoading ? 'animate-spin' : ''}`}
        />
        {updateLoading ? 'Checking...' : 'Check Updates'}
      </Button>
      {updateDetail?.version && (
        <div className="text-sm text-gray-500">
          {`${updateDetail.currentVersion} -> ${updateDetail.version}(latest)`}
        </div>
      )}
      {updateDetail?.link && (
        <div className="text-sm text-gray-500">
          Release Notes:{' '}
          <a
            href={updateDetail.link}
            target="_blank"
            className="underline"
            rel="noreferrer"
          >
            {updateDetail.link}
          </a>
        </div>
      )}
    </div>
  );
};
