require('dotenv').config();
const fs = require('fs');
const path = require('path');
const { Client, Collection, GatewayIntentBits, REST, Routes, PartialUser, Partials } = require('discord.js');
const Scheduler = require('./scheduler');
const { initDatabase, addSubmission } = require('./database');
const https = require('https');
const http = require('http');

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
    
    await initDatabase();
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

    const content = message.content?.trim();
    const attachment = message.attachments.first();

    // Must have both image and code in the same message
    if (!attachment || !attachment.contentType?.startsWith('image/')) {
        return message.reply('❌ Please send an **image** with your **code**!\n\n⚠️ **Important:** You must send the image and code **together in the same message**.\n\n📝 **How to submit:**\n1. Attach your defense screenshot\n2. Write your code in the message text\n3. Send both together!');
    }

    if (!content) {
        return message.reply('❌ Please send your **code** with the image!\n\n⚠️ **Important:** You must send the image and code **together in the same message**.\n\n📝 **How to submit:**\n1. Attach your defense screenshot\n2. Write your code in the message text\n3. Send both together!');
    }

    try {
        const imageData = await downloadImage(attachment.url);
        
        const result = addSubmission(
            message.author.id,
            message.author.username,
            content,
            imageData,
            attachment.name
        );

        await message.reply(`✅ **Submission received!** #${result.lastInsertRowid}\n\n🙏 Thank you for sharing your defense! Your contribution helps the team! 💪\n\n📝 Code: \`${content.substring(0, 50)}${content.length > 50 ? '...' : ''}\`\n🖼️ Image: ✅`);

    } catch (error) {
        console.error('Error saving submission:', error);
        await message.reply('❌ Error saving your submission!');
    }
});

client.login(process.env.DISCORD_TOKEN);
