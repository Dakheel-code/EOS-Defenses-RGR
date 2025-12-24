require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client, Collection, GatewayIntentBits, REST, Routes, PartialUser, Partials, ActionRowBuilder, ButtonBuilder, ButtonStyle } = require('discord.js');
const Scheduler = require('./scheduler');
const db = require('./database');
const https = require('https');
const http = require('http');

// User sessions for conversation flow
const userSessions = new Map();

let dbReady = false;
let dbInitPromise = null;

async function ensureDatabaseReady() {
    if (dbReady) return;
    if (!dbInitPromise) {
        dbInitPromise = db.initDatabase()
            .then(() => {
                dbReady = true;
            })
            .catch((err) => {
                dbInitPromise = null;
                throw err;
            });
    }
    await dbInitPromise;
}

function isImageAttachment(att) {
    const ct = att?.contentType;
    if (typeof ct === 'string' && ct.toLowerCase().startsWith('image/')) return true;
    if (typeof att?.height === 'number' && typeof att?.width === 'number') return true;
    const nameOrUrl = `${att?.name || ''} ${att?.url || ''}`.toLowerCase();
    return /\.(png|jpe?g|webp|gif|bmp|tiff?|heic|heif)(\?|$)/.test(nameOrUrl);
}

const client = new Client({
    intents: [
        GatewayIntentBits.Guilds,
        GatewayIntentBits.GuildMessages,
        GatewayIntentBits.MessageContent,
        GatewayIntentBits.DirectMessages
    ],
    partials: [Partials.Channel, Partials.Message]
});

client.commands = new Collection();

// Load commands
const commandsPath = path.join(__dirname, 'commands');
const commandFiles = fs.readdirSync(commandsPath).filter(file => file.endsWith('.js'));

const commands = [];
for (const file of commandFiles) {
    const filePath = path.join(commandsPath, file);
    const command = require(filePath);
    if ('data' in command && 'execute' in command) {
        client.commands.set(command.data.name, command);
        commands.push(command.data.toJSON());
    }
}

// Register slash commands
async function registerCommands() {
    const rest = new REST().setToken(process.env.DISCORD_TOKEN);
    
    try {
        console.log('Registering commands...');
        console.log('GUILD_IDS:', process.env.GUILD_IDS);
        console.log('GUILD_ID:', process.env.GUILD_ID);

        if (process.env.GUILD_IDS) {
            // Multiple guilds support (comma-separated)
            const guildIds = process.env.GUILD_IDS.split(',').map(id => id.trim());
            console.log('Parsed guild IDs:', guildIds);
            for (const guildId of guildIds) {
                console.log(`Registering for guild: ${guildId}`);
                await rest.put(
                    Routes.applicationGuildCommands(process.env.CLIENT_ID, guildId),
                    { body: commands }
                );
                console.log(`Commands registered for guild: ${guildId}`);
            }
        } else if (process.env.GUILD_ID) {
            // Single guild
            await rest.put(
                Routes.applicationGuildCommands(process.env.CLIENT_ID, process.env.GUILD_ID),
                { body: commands }
            );
        } else {
            // Global commands
            await rest.put(
                Routes.applicationCommands(process.env.CLIENT_ID),
                { body: commands }
            );
        }

        console.log('Commands registered!');
    } catch (error) {
        console.error('Error registering commands:', error);
    }
}

// Download image helper
async function downloadImage(url) {
    return new Promise((resolve, reject) => {
        const protocol = url.startsWith('https') ? https : http;
        protocol.get(url, (response) => {
            const chunks = [];
            response.on('data', (chunk) => chunks.push(chunk));
            response.on('end', () => resolve(Buffer.concat(chunks)));
            response.on('error', reject);
        }).on('error', reject);
    });
}

client.once('ready', async () => {
    console.log(`Logged in as ${client.user.tag}!`);
    
    await ensureDatabaseReady();
    console.log('Database initialized!');
    
    client.scheduler = new Scheduler(client);
    
    await registerCommands();
    
    console.log('Bot is ready!');
});

client.on('interactionCreate', async (interaction) => {
    if (!interaction.isChatInputCommand()) return;

    const command = client.commands.get(interaction.commandName);

    if (!command) return;

    try {
        await command.execute(interaction);
    } catch (error) {
        console.error(`Error executing ${interaction.commandName}:`, error);
        
        const errorMessage = { content: '❌ An error occurred!', ephemeral: true };

        if (interaction.replied || interaction.deferred) {
            await interaction.followUp(errorMessage);
        } else {
            await interaction.reply(errorMessage);
        }
    }
});

// Handle DMs from players
client.on('messageCreate', async (message) => {
    if (message.author.bot) return;
    if (message.guild) return; // Only DMs

    try {
        const userId = message.author.id;
        let session = userSessions.get(userId);

        // If user has no session or sends any message without active session, show service selection
        if (!session) {
            // Clear any potential old session
            userSessions.delete(userId);
            
            const row = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('service_opponents')
                    .setLabel('⚔️ EOS Opponents Defenses')
                    .setStyle(ButtonStyle.Primary),
                new ButtonBuilder()
                    .setCustomId('service_defenses')
                    .setLabel('🛡️ EOS Defenses')
                    .setStyle(ButtonStyle.Success)
            );

            await message.reply({
                content: '👋 **Welcome!**\n\nPlease select a service:',
                components: [row]
            });
            return;
        }

        await ensureDatabaseReady();

    // If uploading opponent images (multiple, no code)
    if (session.step === 'upload_opponents') {
        console.log(`[OPPONENT UPLOAD] User ${userId} sent message with ${message.attachments.size} attachments`);
        const attachments = message.attachments.filter(att => isImageAttachment(att));
        console.log(`[OPPONENT UPLOAD] Filtered to ${attachments.size} image attachments`);
        
        const doneRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('done_opponents')
                .setLabel('✅ Done - Finish Uploading')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId('cancel_submission')
                .setLabel('❌ Cancel')
                .setStyle(ButtonStyle.Danger)
        );
        
        if (attachments.size === 0) {
            console.log(`[OPPONENT UPLOAD] No valid images detected, sending error`);
            return message.reply({
                content: '❌ Please send **images** only! No text needed for Opponents Defenses.',
                components: [doneRow]
            });
        }

        let savedCount = 0;
        const { AttachmentBuilder } = require('discord.js');
        for (const [, attachment] of attachments) {
            console.log(`[OPPONENT UPLOAD] Processing attachment: ${attachment.name}, url: ${attachment.url}`);
            try {
                console.log(`[OPPONENT UPLOAD] Downloading image...`);
                const imageData = await downloadImage(attachment.url);
                console.log(`[OPPONENT UPLOAD] Downloaded ${imageData.length} bytes`);
                console.log(`[OPPONENT UPLOAD] Saving to database...`);
                const result = db.addOpponentDefense(
                    message.author.id,
                    message.author.username,
                    imageData,
                    attachment.name || 'image.png'
                );
                console.log(`[OPPONENT UPLOAD] Saved with ID: ${result.lastInsertRowid}`);
                savedCount++;

                // Send immediate admin notification for this image
                if (process.env.ADMIN_CHANNEL_ID) {
                    try {
                        const adminChannel = client.channels.cache.get(process.env.ADMIN_CHANNEL_ID);
                        if (adminChannel) {
                            const imageAttachment = new AttachmentBuilder(imageData, { name: attachment.name || 'image.png' });
                            const notificationEmbed = {
                                color: 0xff6600,
                                title: '📥 New Opponent Defense Image',
                                fields: [
                                    { name: '🆔 ID', value: `${result.lastInsertRowid}`, inline: true },
                                    { name: '👤 Player', value: `<@${message.author.id}>`, inline: true },
                                    { name: '📛 Username', value: message.author.username, inline: true }
                                ],
                                image: { url: `attachment://${attachment.name || 'image.png'}` },
                                timestamp: new Date().toISOString(),
                                footer: { text: 'Use /opponents to review and approve' }
                            };
                            await adminChannel.send({ 
                                embeds: [notificationEmbed],
                                files: [imageAttachment]
                            });
                        }
                    } catch (notifError) {
                        console.error('Error sending admin notification for opponent image:', notifError);
                    }
                }
            } catch (err) {
                console.error(`[OPPONENT UPLOAD] Error saving opponent image:`, err);
                console.error(`[OPPONENT UPLOAD] Error stack:`, err.stack);
            }
        }
        console.log(`[OPPONENT UPLOAD] Total saved: ${savedCount}`);

        console.log(`[OPPONENT UPLOAD] Fetching pending defenses for count...`);
        const allPending = (typeof db.getAllPendingOpponentDefenses === 'function')
            ? db.getAllPendingOpponentDefenses()
            : [];
        console.log(`[OPPONENT UPLOAD] Total pending in DB: ${allPending.length}`);
        let userImages = allPending.filter(def => def.user_id === userId);
        console.log(`[OPPONENT UPLOAD] User images before filter: ${userImages.length}`);
        if (typeof session.startedAt === 'number') {
            userImages = userImages.filter(def => {
                const raw = String(def.created_at || '');
                const iso = raw.includes('T') ? raw : raw.replace(' ', 'T');
                const created = new Date(`${iso}Z`).getTime();
                return Number.isFinite(created) ? created >= session.startedAt : true;
            });
        }
        const totalCount = userImages.length;
        console.log(`[OPPONENT UPLOAD] Final count - saved: ${savedCount}, total: ${totalCount}`);

        await message.reply({
            content: `✅ **${savedCount} image(s) received!** (Total: ${totalCount})\n\n📸 Send more images or click **Done** when finished.`,
            components: [doneRow]
        });
        return;
    }

    // If waiting for image + code (EOS Defenses)
    if (session.step === 'upload_image') {
        const content = message.content?.trim();
        const attachment = message.attachments.first();

        if (!attachment || !isImageAttachment(attachment)) {
            return message.reply('❌ Please send an **image** with your **code**!\n\n📝 **How to submit:**\n1. Attach your defense screenshot\n2. Write your code in the message text\n3. Send both together!');
        }

        if (!content) {
            return message.reply('❌ Please send your **code** with the image!');
        }

        try {
            const imageData = await downloadImage(attachment.url);
            
            const result = db.addSubmission(
                message.author.id,
                message.author.username,
                content,
                imageData,
                attachment.name || 'image.png',
                session.service // Pass service type
            );

            const serviceLabel = session.service === 'opponents' ? '⚔️ EOS Opponents Defenses' : '🛡️ EOS Defenses';
            
            // Clear session
            userSessions.delete(userId);

            await message.reply(`✅ **Submission received!** #${result.lastInsertRowid}\n\n📂 Service: ${serviceLabel}\n🙏 Thank you for sharing your defense! 💪\n\n📝 Code: \`${content.substring(0, 50)}${content.length > 50 ? '...' : ''}\`\n🖼️ Image: ✅`);

            // Send admin notification
            if (process.env.ADMIN_CHANNEL_ID) {
                try {
                    const adminChannel = client.channels.cache.get(process.env.ADMIN_CHANNEL_ID);
                    if (adminChannel) {
                        const { AttachmentBuilder } = require('discord.js');
                        
                        const imageAttachment = new AttachmentBuilder(imageData, { name: attachment.name || 'image.png' });
                        
                        const notificationEmbed = {
                            color: session.service === 'opponents' ? 0xff6600 : 0x00ff00,
                            title: '📥 New Submission Received!',
                            fields: [
                                { name: '🆔 ID', value: `${result.lastInsertRowid}`, inline: true },
                                { name: '👤 Player', value: `<@${message.author.id}>`, inline: true },
                                { name: '📛 Username', value: message.author.username, inline: true },
                                { name: '📂 Service', value: serviceLabel, inline: true }
                            ],
                            image: { url: `attachment://${attachment.name || 'image.png'}` },
                            timestamp: new Date().toISOString(),
                            footer: { text: 'Use /list to manage submissions' }
                        };
                        const notifMessage = await adminChannel.send({ 
                            embeds: [notificationEmbed],
                            files: [imageAttachment]
                        });
                        
                        const thread = await notifMessage.startThread({
                            name: `Code - ${message.author.username}`,
                            autoArchiveDuration: 1440
                        });
                        
                        const threadImageAttachment = new AttachmentBuilder(imageData, { name: attachment.name || 'image.png' });
                        await thread.send({ files: [threadImageAttachment] });
                        await thread.send(`\`\`\`\n${content}\n\`\`\``);
                    }
                } catch (notifError) {
                    console.error('Error sending admin notification:', notifError);
                }
            }

        } catch (error) {
            console.error('Error saving submission:', error);
            await message.reply('❌ Error saving your submission!');
        }
    }
    } catch (err) {
        console.error('Error in DM messageCreate handler:', err);
        try {
            const msg = (err && err.message) ? err.message : 'unknown error';
            await message.reply(`❌ An unexpected error occurred. Please try again.\n(${msg})`);
        } catch (_) {}
    }
});

// Handle button interactions for DM service selection
client.on('interactionCreate', async (interaction) => {
    if (!interaction.isButton()) return;
    if (interaction.guild) return; // Only DMs

    const userId = interaction.user.id;

    try {
        await ensureDatabaseReady();
        if (interaction.customId === 'service_opponents') {
            userSessions.set(userId, { step: 'upload_opponents', service: 'opponents', imageCount: 0, startedAt: Date.now() });
        
        const doneRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('done_opponents')
                .setLabel('✅ Done - Finish Uploading')
                .setStyle(ButtonStyle.Success),
            new ButtonBuilder()
                .setCustomId('cancel_submission')
                .setLabel('❌ Cancel')
                .setStyle(ButtonStyle.Danger)
        );

        await interaction.update({
            content: '⚔️ **EOS Opponents Defenses**\n\n📸 Send your defense **screenshots** (images only, no code needed)\n\n📌 You can send:\n- Multiple images in one message\n- Or one image per message\n\n✅ Click **Done** when you finish uploading all images.',
            components: [doneRow]
        });
    } else if (interaction.customId === 'service_defenses') {
        userSessions.set(userId, { step: 'upload_image', service: 'defenses' });
        
        const cancelRow = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('cancel_submission')
                .setLabel('❌ Cancel')
                .setStyle(ButtonStyle.Danger)
        );

        await interaction.update({
            content: '🛡️ **EOS Defenses**\n\nPlease send an **image** with your **code**!\n\n⚠️ **Important:** You must send the image and code **together in the same message**.\n\n📝 **How to submit:**\n1. Attach your defense screenshot\n2. Write your code in the message text\n3. Send both together!',
            components: [cancelRow]
        });
    } else if (interaction.customId === 'done_opponents') {
        await interaction.deferUpdate();
        
        // Get actual count from database for this user
        const session = userSessions.get(userId);
        const allPending = (typeof db.getAllPendingOpponentDefenses === 'function')
            ? db.getAllPendingOpponentDefenses()
            : [];
        let userImages = allPending.filter(def => def.user_id === userId);
        if (typeof session?.startedAt === 'number') {
            userImages = userImages.filter(def => {
                const raw = String(def.created_at || '');
                const iso = raw.includes('T') ? raw : raw.replace(' ', 'T');
                const created = new Date(`${iso}Z`).getTime();
                return Number.isFinite(created) ? created >= session.startedAt : true;
            });
        }
        const count = userImages.length;
        
        userSessions.delete(userId);
        
        if (count === 0) {
            await interaction.message.edit({
                content: '❌ **No images uploaded!**\n\nYou need to send at least one image.',
                components: []
            });
        } else {
            await interaction.message.edit({
                content: `✅ **Upload Complete!**\n\n📊 Total images uploaded: **${count}**\n\n🙏 Thank you! An admin will review your submissions soon.`,
                components: []
            });
        }
    } else if (interaction.customId === 'cancel_submission') {
        await interaction.deferUpdate();
        userSessions.delete(userId);
        
        const row = new ActionRowBuilder().addComponents(
            new ButtonBuilder()
                .setCustomId('service_opponents')
                .setLabel('⚔️ EOS Opponents Defenses')
                .setStyle(ButtonStyle.Primary),
            new ButtonBuilder()
                .setCustomId('service_defenses')
                .setLabel('🛡️ EOS Defenses')
                .setStyle(ButtonStyle.Success)
        );

        await interaction.message.edit({
            content: '❌ **Cancelled!**\n\n👋 **Welcome!**\n\nPlease select a service:',
            components: [row]
        });
    }
    } catch (err) {
        console.error('Error in DM button interaction handler:', err);
        try {
            if (!interaction.deferred && !interaction.replied) {
                const msg = (err && err.message) ? err.message : 'unknown error';
                await interaction.reply({ content: `❌ An error occurred. Please try again.\n(${msg})`, ephemeral: true });
            }
        } catch (_) {}
    }
});

client.login(process.env.DISCORD_TOKEN);
