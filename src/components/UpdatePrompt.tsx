import React from 'react';
import { Linking } from 'react-native';
import * as Updates from 'expo-updates';
import AppConfirmModal from './AppConfirmModal';

export type UpdateType = 'ota' | 'binary' | null;

interface UpdatePromptProps {
  visible: boolean;
  updateType: UpdateType;
  isDarkMode: boolean;
  binaryApkUrl?: string;
  binaryVersion?: string;
  onClose: () => void;
}

export default function UpdatePrompt({
  visible,
  updateType,
  isDarkMode,
  binaryApkUrl,
  binaryVersion,
  onClose,
}: UpdatePromptProps) {
  if (!visible || !updateType) return null;

  const isBinary = updateType === 'binary';
  const title = isBinary ? '发现新版本' : '发现新版本';
  const message = isBinary
    ? `检测到新版本 ${binaryVersion || ''}，建议立即下载安装以体验最新功能。`
    : '更新已下载，是否立即重启应用完成更新？';

  const handleConfirm = () => {
    onClose();
    if (isBinary && binaryApkUrl) {
      void Linking.openURL(binaryApkUrl);
    } else if (!isBinary) {
      void Updates.reloadAsync();
    }
  };

  return (
    <AppConfirmModal
      visible={visible}
      isDarkMode={isDarkMode}
      title={title}
      message={message}
      confirmText="立即更新"
      cancelText="稍后再说"
      onCancel={onClose}
      onConfirm={handleConfirm}
    />
  );
}
