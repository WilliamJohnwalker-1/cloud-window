export interface EmojiAvatar {
  emoji: string;
  bgColor: string;
}

export const parseEmojiAvatar = (value?: string | null): EmojiAvatar | null => {
  if (!value || !value.startsWith('emoji|')) return null;
  const parts = value.split('|');
  if (parts.length < 3) return null;
  return {
    emoji: parts[1],
    bgColor: parts[2],
  };
};
