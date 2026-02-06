const {
  Client,
  GatewayIntentBits,
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  ModalBuilder,
  TextInputBuilder,
  TextInputStyle,
  Events,
  PermissionFlagsBits
} = require('discord.js');
const fs = require('fs');
const http = require('http');

// Renderなどのホスティングサービスで起動し続けるための簡易サーバー
http.createServer((req, res) => {
  res.write('Bot is running!');
  res.end();
}).listen(process.env.PORT || 8080);

const client = new Client({
  intents: [
    GatewayIntentBits.Guilds,
    GatewayIntentBits.GuildMessages,
    GatewayIntentBits.MessageContent,
    GatewayIntentBits.DirectMessages
  ]
});

// ===== 設定 =====
const TOKEN = process.env.DISCORD_TOKEN;
const INPUT_CHANNEL_ID = '1454283599519154176';
const POST_CHANNEL_ID = '1454283796147998863';
const DATA_FILE = './reservations.json';
const MAX_RESERVATIONS = 10;
// =================

// ---------- データ ----------
function loadData() {
  if (!fs.existsSync(DATA_FILE)) return {};
  try {
    const data = fs.readFileSync(DATA_FILE, 'utf8');
    return data ? JSON.parse(data) : {};
  } catch (e) {
    console.error('Data load error:', e);
    return {};
  }
}
function saveData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2));
}

// ---------- 起動 ----------
client.once('ready', async () => {
  console.log(`起動完了: ${client.user.tag}`);

  // スラッシュコマンドの登録
  const commands = [
    {
      name: 'reset',
      description: 'ユーザーの予約回数をリセットします',
      default_member_permissions: PermissionFlagsBits.Administrator.toString(),
      options: [
        {
          name: 'user',
          type: 6, // USER type
          description: 'リセットするユーザー（指定しない場合は自分）',
          required: false
        }
      ]
    }
  ];

  try {
    await client.application.commands.set(commands);
    console.log('スラッシュコマンドを登録しました');
  } catch (error) {
    console.error('スラッシュコマンドの登録中にエラーが発生しました:', error);
  }
});

// ---------- パネル ----------
client.on('messageCreate', async msg => {
  if (msg.author.bot) return;
  if (msg.channel.id !== INPUT_CHANNEL_ID) return;
  if (msg.content !== '!panel') return;

  const row = new ActionRowBuilder().addComponents(
    new ButtonBuilder()
      .setCustomId('reserve')
      .setLabel('📅 お助け予約する')
      .setStyle(ButtonStyle.Primary)
  );

  await msg.reply({ content: 'お助け予約パネル', components: [row] });
});

// ---------- インタラクション ----------
client.on(Events.InteractionCreate, async interaction => {

  // ===== スラッシュコマンド =====
  if (interaction.isChatInputCommand()) {
    if (interaction.commandName === 'reset') {
      const targetUser = interaction.options.getUser('user') || interaction.user;
      const data = loadData();

      let count = 0;
      const channel = await client.channels.fetch(POST_CHANNEL_ID).catch(() => null);

      const newData = {};
      for (const id in data) {
        if (data[id].owner === targetUser.id) {
          // 投稿されたメッセージを削除
          if (channel && data[id].messageId) {
            const msg = await channel.messages.fetch(data[id].messageId).catch(() => null);
            if (msg) await msg.delete().catch(() => { });
          }
          count++;
        } else {
          newData[id] = data[id];
        }
      }

      saveData(newData);
      return interaction.reply({ content: `✅ ${targetUser.tag} の予約回数（${count}件）をリセットしました。`, ephemeral: true });
    }
  }


  // ===== 予約ボタン =====
  if (interaction.isButton() && interaction.customId === 'reserve') {
    const data = loadData();
    if (Object.keys(data).length >= MAX_RESERVATIONS) {
      return interaction.reply({ content: '予約上限に達しています', ephemeral: true });
    }

    const modal = new ModalBuilder()
      .setCustomId('reserve_modal')
      .setTitle('お助け予約');

    const fields = [
      ['level', 'レベル', '10'],
      ['date', '日付', '1/1'],
      ['time', '時間帯', '12:00頃'],
      ['puni', 'ぷに名', 'ジバニャン'],
      ['code', 'キャラクターコード', 'XXXX']
    ].map(v =>
      new ActionRowBuilder().addComponents(
        new TextInputBuilder()
          .setCustomId(v[0])
          .setLabel(v[1])
          .setStyle(TextInputStyle.Short)
          .setPlaceholder(v[2])
          .setRequired(true)
      )
    );

    modal.addComponents(...fields);
    return interaction.showModal(modal);
  }

  // ===== モーダル送信 =====
  if (interaction.isModalSubmit() && interaction.customId === 'reserve_modal') {
    const data = loadData();
    const id = Date.now().toString();

    data[id] = {
      owner: interaction.user.id,
      level: interaction.fields.getTextInputValue('level'),
      date: interaction.fields.getTextInputValue('date'),
      time: interaction.fields.getTextInputValue('time'),
      puni: interaction.fields.getTextInputValue('puni'),
      code: interaction.fields.getTextInputValue('code'),
      participants: [],
      messageId: null
    };
    saveData(data);

    const channel = await client.channels.fetch(POST_CHANNEL_ID);

    const row = new ActionRowBuilder().addComponents(
      new ButtonBuilder().setCustomId(`join_${id}`).setLabel('🟢 参加').setStyle(ButtonStyle.Success),
      new ButtonBuilder().setCustomId(`leave_${id}`).setLabel('🔴 キャンセル').setStyle(ButtonStyle.Danger)
    );

    const post = await channel.send({
      content:
        `📅 お助け予約が入りました！

👤 予約者：<@${interaction.user.id}>
📈 レベル：${data[id].level}
📆 日付：${data[id].date}
⏰ 時間帯：${data[id].time}
🐾 ぷに：${data[id].puni}
🔑 コード：${data[id].code}`,
      components: [row]
    });

    data[id].messageId = post.id;
    saveData(data);

    const cancelRow = new ActionRowBuilder().addComponents(
      new ButtonBuilder()
        .setCustomId(`cancel_${id}`)
        .setLabel('❌ 予約をキャンセル')
        .setStyle(ButtonStyle.Danger)
    );

    await interaction.user.send({
      content: '✅ お助け予約が完了しました',
      components: [cancelRow]
    }).catch(() => { });

    return interaction.deferUpdate();
  }

  // ===== 参加 =====
  if (interaction.isButton() && interaction.customId.startsWith('join_')) {
    const id = interaction.customId.split('_')[1];
    const data = loadData();
    if (!data[id]) return interaction.deferUpdate();

    if (!data[id].participants.includes(interaction.user.id)) {
      data[id].participants.push(interaction.user.id);
      saveData(data);

      const owner = await client.users.fetch(data[id].owner);
      await owner.send(`✅ 参加者が来ました\nユーザー：${interaction.user.tag}`).catch(() => { });
      await interaction.user.send('🟢 参加完了しました').catch(() => { });
    }
    return interaction.deferUpdate();
  }

  // ===== 参加キャンセル =====
  if (interaction.isButton() && interaction.customId.startsWith('leave_')) {
    const id = interaction.customId.split('_')[1];
    const data = loadData();
    if (!data[id]) return interaction.deferUpdate();

    const idx = data[id].participants.indexOf(interaction.user.id);
    if (idx !== -1) {
      data[id].participants.splice(idx, 1);
      saveData(data);

      const owner = await client.users.fetch(data[id].owner);
      await owner.send(`❌ 参加者がキャンセルしました\nユーザー：${interaction.user.tag}`).catch(() => { });
      await interaction.user.send('🔴 キャンセル完了しました').catch(() => { });
    }
    return interaction.deferUpdate();
  }

  // ===== 予約キャンセル（DM） =====
  if (interaction.isButton() && interaction.customId.startsWith('cancel_')) {
    const id = interaction.customId.split('_')[1];
    const data = loadData();
    if (!data[id] || data[id].owner !== interaction.user.id) {
      return interaction.deferUpdate();
    }

    const channel = await client.channels.fetch(POST_CHANNEL_ID);
    const msg = await channel.messages.fetch(data[id].messageId).catch(() => { });
    if (msg) await msg.delete().catch(() => { });

    delete data[id];
    saveData(data);

    await interaction.user.send('❌ 予約をキャンセルしました').catch(() => { });
    return interaction.deferUpdate();
  }
});

if (TOKEN) {
  client.login(TOKEN);
} else {
  console.error('TOKEN is not set in environment variables.');
}