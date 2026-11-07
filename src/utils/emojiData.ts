import type { IconName } from '../components/Icon';

/**
 * The emoji in the reaction sheet, by category, each with the words a search finds it by.
 * Hand-picked rather than a package: the full Unicode set with its names costs hundreds of KB
 * in the bundle, and nobody reacts with most of it.
 */
export type Emoji = { char: string; words: string };
export type EmojiCategory = { key: string; label: string; icon: IconName; emojis: Emoji[] };

/** Each line is the emoji, a space, then its search words. */
const parse = (lines: string[]): Emoji[] =>
  lines.map(line => {
    const space = line.indexOf(' ');
    return { char: line.slice(0, space), words: line.slice(space + 1) };
  });

export const EMOJI_CATEGORIES: EmojiCategory[] = [
  {
    key: 'smileys',
    label: 'Smileys',
    icon: 'emojiSmileys',
    emojis: parse([
      '😀 grinning happy smile', '😃 smile happy', '😄 smile happy laugh', '😁 grin beam teeth',
      '😆 laugh squint haha', '😅 sweat nervous laugh', '🤣 rofl rolling laugh lol', '😂 joy tears laugh cry lol',
      '🙂 slight smile', '🙃 upside down silly', '🫠 melting', '😉 wink', '😊 blush smile happy', '😇 angel halo innocent',
      '🥰 love hearts adore', '😍 heart eyes love', '🤩 star struck wow', '😘 kiss love', '😗 kiss', '😙 kiss smile',
      '😚 kiss blush', '😋 yum tasty delicious', '😛 tongue', '😜 wink tongue crazy', '🤪 zany crazy goofy',
      '😝 tongue squint', '🤑 money rich', '🤗 hug', '🤭 giggle oops', '🫢 gasp oops', '🫣 peek shy', '🤫 shush quiet secret',
      '🤔 thinking hmm', '🫡 salute respect', '🤐 zip quiet', '🤨 raised eyebrow suspicious', '😐 neutral', '😑 expressionless',
      '😶 no mouth silent', '😏 smirk', '😒 unamused', '🙄 eye roll', '😬 grimace awkward', '😮‍💨 exhale sigh relief',
      '😌 relieved calm', '😔 pensive sad', '😪 sleepy', '🤤 drool', '😴 sleep zzz tired', '😷 mask sick', '🤒 sick fever',
      '🤕 hurt injured', '🤢 nausea sick', '🤮 vomit sick', '🤧 sneeze cold', '🥵 hot sweating', '🥶 cold freezing',
      '🥴 woozy drunk', '😵 dizzy', '🤯 mind blown shocked', '🤠 cowboy', '🥳 party celebrate birthday', '😎 cool sunglasses',
      '🤓 nerd', '🧐 monocle curious', '😕 confused', '😟 worried', '🙁 frown sad', '😮 wow surprised', '😯 hushed surprised',
      '😲 astonished shocked', '😳 flushed embarrassed', '🥺 pleading puppy eyes please', '🥹 tears holding back moved',
      '😨 fearful scared', '😰 anxious sweat', '😥 sad relieved', '😢 cry sad tear', '😭 sob crying', '😱 scream fear',
      '😞 disappointed', '😓 downcast sweat', '😩 weary', '😫 tired', '🥱 yawn bored', '😤 huff triumph', '😡 angry rage',
      '😠 angry mad', '🤬 cursing swear', '😈 devil smile', '👿 devil angry', '💀 skull dead', '☠️ skull bones', '💩 poop',
      '🤡 clown', '👻 ghost', '👽 alien', '🤖 robot',
    ]),
  },
  {
    key: 'people',
    label: 'People',
    icon: 'emojiPeople',
    emojis: parse([
      '👋 wave hi hello bye', '🤚 raised back hand', '✋ raised hand stop', '🖐️ hand fingers', '👌 ok perfect', '🤌 pinched italian',
      '🤏 pinch small', '✌️ peace victory', '🤞 fingers crossed luck', '🫰 finger heart snap', '🤟 love you', '🤘 rock horns metal',
      '🤙 call shaka', '👈 point left', '👉 point right', '👆 point up', '👇 point down', '☝️ index up', '🫵 point you',
      '👍 thumbs up yes like', '👎 thumbs down no dislike', '✊ fist power', '👊 punch fist bump', '🤛 left fist', '🤜 right fist',
      '👏 clap applause', '🙌 raised hands praise yay', '🫶 heart hands love', '👐 open hands', '🤲 palms up', '🤝 handshake deal',
      '🙏 pray thanks please namaste', '✍️ writing', '💅 nails sass', '💪 muscle strong flex', '🧠 brain smart', '👀 eyes look',
      '👅 tongue', '👄 lips mouth', '🫦 biting lip', '🙋 raise hand', '🙆 ok gesture', '🙅 no gesture', '🤷 shrug idk',
      '🤦 facepalm', '🙇 bow sorry', '💃 dance woman', '🕺 dance man', '🧑‍🎤 singer star', '🧑‍💻 developer laptop', '👶 baby',
    ]),
  },
  {
    key: 'nature',
    label: 'Animals and nature',
    icon: 'emojiNature',
    emojis: parse([
      '🐶 dog puppy', '🐱 cat kitten', '🐭 mouse', '🐹 hamster', '🐰 rabbit bunny', '🦊 fox', '🐻 bear', '🐼 panda', '🐨 koala',
      '🐯 tiger', '🦁 lion', '🐮 cow', '🐷 pig', '🐸 frog', '🐵 monkey', '🙈 see no evil monkey shy', '🙉 hear no evil monkey',
      '🙊 speak no evil monkey', '🐔 chicken', '🐧 penguin', '🐦 bird', '🦆 duck', '🦅 eagle', '🦉 owl', '🦇 bat', '🐺 wolf',
      '🐴 horse', '🦄 unicorn', '🐝 bee', '🦋 butterfly', '🐞 ladybug', '🐢 turtle', '🐍 snake', '🐙 octopus', '🐬 dolphin',
      '🐳 whale', '🦈 shark', '🐘 elephant', '🌸 cherry blossom flower', '🌹 rose flower', '🌻 sunflower', '🌷 tulip', '🌱 seedling plant',
      '🌴 palm tree', '🍀 clover luck', '🍁 maple leaf', '🌈 rainbow', '☀️ sun', '🌙 moon night', '⭐ star', '🌟 glowing star',
      '✨ sparkles', '⚡ lightning', '🔥 fire lit hot', '💧 droplet water', '🌊 wave ocean', '❄️ snow cold', '☁️ cloud', '🌧️ rain',
    ]),
  },
  {
    key: 'food',
    label: 'Food and drink',
    icon: 'emojiFood',
    emojis: parse([
      '🍎 apple', '🍊 orange', '🍋 lemon', '🍌 banana', '🍉 watermelon', '🍇 grapes', '🍓 strawberry', '🥭 mango', '🍍 pineapple',
      '🥥 coconut', '🥑 avocado', '🌶️ chilli pepper spicy', '🌽 corn', '🍕 pizza', '🍔 burger', '🍟 fries', '🌭 hot dog', '🥪 sandwich',
      '🌮 taco', '🍿 popcorn', '🍗 chicken', '🍛 curry rice', '🍚 rice', '🍜 noodles ramen', '🍝 pasta', '🍣 sushi', '🍪 cookie',
      '🎂 birthday cake', '🍰 cake', '🧁 cupcake', '🍫 chocolate', '🍬 candy', '🍭 lollipop', '🍩 donut', '🍦 ice cream',
      '☕ coffee chai', '🍵 tea chai', '🧋 boba bubble tea', '🥤 soda drink', '🍺 beer', '🍻 cheers beer', '🍷 wine', '🥂 cheers champagne',
      '🍸 cocktail', '🍹 tropical drink', '🥃 whiskey',
    ]),
  },
  {
    key: 'activity',
    label: 'Activities',
    icon: 'emojiActivity',
    emojis: parse([
      '⚽ football soccer', '🏀 basketball', '🏏 cricket', '🏈 american football', '⚾ baseball', '🎾 tennis', '🏐 volleyball',
      '🏓 table tennis ping pong', '🏸 badminton', '🥊 boxing', '🏆 trophy win', '🥇 gold medal first', '🏅 medal', '🎯 target bullseye',
      '🎮 video game', '🎲 dice game', '🎧 headphones music', '🎤 microphone sing karaoke', '🎹 piano keyboard music', '🎸 guitar music',
      '🥁 drum music', '🎷 saxophone music', '🎺 trumpet music', '🎻 violin music', '🎵 music note', '🎶 music notes', '🎼 score music',
      '🎬 movie film', '🎨 art paint', '🎭 theatre drama', '🎉 party popper celebrate', '🎊 confetti celebrate', '🎈 balloon', '🎁 gift present',
      '🪩 disco ball party', '🎟️ ticket',
    ]),
  },
  {
    key: 'travel',
    label: 'Travel and places',
    icon: 'emojiTravel',
    emojis: parse([
      '🚗 car', '🚕 taxi cab', '🚌 bus', '🏎️ race car', '🏍️ motorcycle bike', '🛺 auto rickshaw', '🚲 bicycle cycle', '🚆 train', '🚀 rocket launch',
      '✈️ plane flight', '🛸 ufo', '🚢 ship', '🏠 house home', '🏡 home garden', '🏢 office building', '🏖️ beach', '🏝️ island', '🏔️ mountain snow',
      '⛰️ mountain', '🌋 volcano', '🗽 statue of liberty', '🗼 tower', '🕌 mosque', '🛕 hindu temple', '⛪ church', '🌍 earth world', '🌏 earth asia world',
      '🗺️ map', '🌃 night city', '🌆 city sunset', '🌅 sunrise', '🌄 sunrise mountains', '🎡 ferris wheel', '🎢 roller coaster',
    ]),
  },
  {
    key: 'objects',
    label: 'Objects',
    icon: 'emojiObjects',
    emojis: parse([
      '📱 phone mobile', '💻 laptop computer', '⌚ watch', '📷 camera photo', '🎥 video camera', '📺 tv', '📻 radio', '🔋 battery', '💡 idea bulb light',
      '🔦 torch flashlight', '💸 money flying', '💰 money bag', '💎 diamond gem', '💍 ring', '👑 crown king queen', '🎩 top hat', '🧢 cap', '👟 shoe sneaker',
      '👠 heel', '👗 dress', '👕 shirt', '🕶️ sunglasses', '🎒 backpack', '📚 books', '📖 book read', '✏️ pencil', '📝 note memo', '📌 pin', '📎 paperclip',
      '🔒 lock', '🔑 key', '🔨 hammer', '🧲 magnet', '💊 pill medicine', '🧸 teddy bear', '🪄 magic wand', '🕯️ candle', '⏰ alarm clock', '⏳ hourglass time',
      '📣 megaphone', '🔔 bell',
    ]),
  },
  {
    key: 'symbols',
    label: 'Symbols',
    icon: 'emojiSymbols',
    emojis: parse([
      '❤️ red heart love', '🧡 orange heart', '💛 yellow heart', '💚 green heart', '💙 blue heart', '💜 purple heart', '🖤 black heart', '🤍 white heart',
      '🤎 brown heart', '💔 broken heart', '❤️‍🔥 heart on fire', '💕 two hearts', '💞 revolving hearts', '💓 beating heart', '💗 growing heart',
      '💖 sparkling heart', '💘 heart arrow', '💝 heart ribbon', '💯 hundred', '💢 anger', '💥 boom collision', '💫 dizzy star', '💦 sweat drops',
      '💨 dash wind', '💬 speech', '💭 thought', '💤 zzz sleep', '✅ check yes done', '❌ cross no', '❗ exclamation', '❓ question', '⚠️ warning',
      '🚫 prohibited no', '♻️ recycle', '➕ plus', '➖ minus', '🆗 ok', '🆒 cool', '🆕 new', '🔝 top', '🔁 repeat', '🔊 loud speaker', '🔇 mute', '♾️ infinity',
    ]),
  },
  {
    key: 'flags',
    label: 'Flags',
    icon: 'flag',
    emojis: parse([
      '🇮🇳 india', '🏁 chequered flag finish', '🏳️‍🌈 pride rainbow flag', '🇺🇸 usa america', '🇬🇧 uk britain', '🇨🇦 canada', '🇦🇺 australia', '🇩🇪 germany',
      '🇫🇷 france', '🇪🇸 spain', '🇮🇹 italy', '🇯🇵 japan', '🇰🇷 korea', '🇨🇳 china', '🇧🇷 brazil', '🇲🇽 mexico', '🇦🇪 uae dubai emirates', '🇸🇬 singapore',
      '🇳🇵 nepal', '🇧🇩 bangladesh', '🇱🇰 sri lanka', '🇵🇰 pakistan', '🇿🇦 south africa', '🇳🇬 nigeria', '🇷🇺 russia', '🇹🇷 turkey', '🇸🇦 saudi arabia',
      '🇮🇪 ireland', '🇳🇱 netherlands', '🇵🇹 portugal', '🇦🇷 argentina',
    ]),
  },
];

const ALL_EMOJIS = EMOJI_CATEGORIES.flatMap(c => c.emojis);

/** Emoji whose search words contain every word typed. Empty for an empty search. */
export function searchEmojis(query: string): string[] {
  const words = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (words.length === 0) { return []; }
  const found = ALL_EMOJIS.filter(e => words.every(w => e.words.includes(w))).map(e => e.char);
  return [...new Set(found)];
}

/** `items` as rows of `size`, for a grid in a list. */
export function chunk<T>(items: readonly T[], size: number): T[][] {
  const rows: T[][] = [];
  for (let i = 0; i < items.length; i += size) { rows.push(items.slice(i, i + size)); }
  return rows;
}
