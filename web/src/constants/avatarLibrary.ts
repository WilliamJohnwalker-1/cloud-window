export interface PresetAvatar {
  id: string;
  value: string;
  emoji: string;
  bgColor: string;
  label: string;
}

const avatar = (id: string, emoji: string, bgColor: string, label: string): PresetAvatar => ({
  id,
  value: `emoji|${emoji}|${bgColor}`,
  emoji,
  bgColor,
  label,
});

export const avatarLibrary: PresetAvatar[] = [
  avatar('animal-dog', '🐶', '#FFE7D8', '小狗'),
  avatar('animal-cat', '🐱', '#FFE3EF', '小猫'),
  avatar('animal-rabbit', '🐰', '#F4E8FF', '兔子'),
  avatar('animal-bear', '🐻', '#FFEACF', '小熊'),
  avatar('animal-panda', '🐼', '#E8EDF8', '熊猫'),
  avatar('animal-koala', '🐨', '#E5F2FF', '考拉'),
  avatar('animal-fox', '🦊', '#FFE6CC', '狐狸'),
  avatar('animal-lion', '🦁', '#FFF1CC', '狮子'),
  avatar('fruit-apple', '🍎', '#FFE3E3', '苹果'),
  avatar('fruit-orange', '🍊', '#FFEBD9', '橙子'),
  avatar('fruit-banana', '🍌', '#FFF4C8', '香蕉'),
  avatar('fruit-watermelon', '🍉', '#FFE1E8', '西瓜'),
  avatar('fruit-grapes', '🍇', '#EEE1FF', '葡萄'),
  avatar('fruit-strawberry', '🍓', '#FFDCE8', '草莓'),
  avatar('vegetable-carrot', '🥕', '#FFE8D1', '胡萝卜'),
  avatar('vegetable-broccoli', '🥦', '#E3F6E3', '西兰花'),
  avatar('vegetable-corn', '🌽', '#FFF4D6', '玉米'),
  avatar('vegetable-avocado', '🥑', '#E4F3D6', '牛油果'),
  avatar('vegetable-potato', '🥔', '#F1E5D4', '土豆'),
  avatar('vegetable-onion', '🧅', '#EFE7F8', '洋葱'),
];
