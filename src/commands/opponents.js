const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits, AttachmentBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { getAllPendingOpponentDefenses, getAllApprovedOpponentDefenses, getOpponentDefenseById, approveOpponentDefense, rejectOpponentDefense, getNextOpponentNumber, markOpponentAsPublished, clearAllOpponentDefenses } = require('../database');
const { processOpponentImage } = require('../imageProcessor');

module.exports = {
    data: new SlashCommandBuilder()
        .setName('opponents')
        .setDescription('Manage EOS Opponents Defenses (images)')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        let pendingDefenses = getAllPendingOpponentDefenses();
        let approvedDefenses = getAllApprovedOpponentDefenses();
        
        let currentIndex = 0;
        let viewMode = 'pending'; // 'pending' or 'approved'

        const generateEmbed = (index, mode) => {
            const defenses = mode === 'pending' ? pendingDefenses : approvedDefenses;
            
            if (defenses.length === 0) {
                return {
                    embed: {
                        color: 0x808080,
                        title: mode === 'pending' ? '📭 No Pending Defenses' : '📭 No Approved Defenses',
                        description: mode === 'pending' 
                            ? 'There are no opponent defenses waiting for review.\n\nPlayers can send images via DM → ⚔️ EOS Opponents Defenses'
                            : 'No defenses have been approved yet.\n\nReview pending defenses first.',
                        timestamp: new Date().toISOString()
                    },
                    files: [],
                    defense: null
                };
            }

            const def = defenses[index];
            const files = [];
            
            // Use processed image if approved, otherwise original
            const imageData = mode === 'approved' && def.processed_image 
                ? def.processed_image 
                : def.image_data;
            
            if (imageData) {
                const attachment = new AttachmentBuilder(
                    Buffer.from(imageData),
                    { name: def.image_filename || 'defense.png' }
                );
                files.push(attachment);
            }

            const embed = {
                color: mode === 'pending' ? 0xffaa00 : 0x00ff00,
                title: mode === 'pending' 
                    ? `⏳ Pending Review (${index + 1}/${defenses.length})`
                    : `✅ Approved (${index + 1}/${defenses.length})`,
                fields: [
                    { name: '🆔 ID', value: `${def.id}`, inline: true },
                    { name: '👤 Player', value: `<@${def.user_id}>`, inline: true },
                    { name: '📛 Username', value: def.username, inline: true },
                    { name: '📅 Date', value: def.created_at, inline: true }
                ],
                image: { url: `attachment://${def.image_filename || 'defense.png'}` },
                timestamp: new Date().toISOString()
            };

            if (mode === 'approved' && def.number) {
                embed.fields.push({ name: '🔢 Number', value: `#${def.number}`, inline: true });
            }

            return { embed, files, defense: def };
        };

        const generateButtons = (index, mode) => {
            const defenses = mode === 'pending' ? pendingDefenses : approvedDefenses;
            const hasDefenses = defenses.length > 0;

            const navRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('opp_prev')
                    .setLabel('◀️ Previous')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(!hasDefenses || index === 0),
                new ButtonBuilder()
                    .setCustomId('opp_next')
                    .setLabel('Next ▶️')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(!hasDefenses || index === defenses.length - 1),
                new ButtonBuilder()
                    .setCustomId('opp_refresh')
                    .setLabel('🔄 Refresh')
                    .setStyle(ButtonStyle.Secondary)
            );

            const modeRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('opp_view_pending')
                    .setLabel(`⏳ Pending (${pendingDefenses.length})`)
                    .setStyle(mode === 'pending' ? ButtonStyle.Primary : ButtonStyle.Secondary),
                new ButtonBuilder()
                    .setCustomId('opp_view_approved')
                    .setLabel(`✅ Approved (${approvedDefenses.length})`)
                    .setStyle(mode === 'approved' ? ButtonStyle.Success : ButtonStyle.Secondary)
            );

            if (mode === 'pending') {
                const actionRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('opp_approve')
                        .setLabel('✅ Approve')
                        .setStyle(ButtonStyle.Success)
                        .setDisabled(!hasDefenses),
                    new ButtonBuilder()
                        .setCustomId('opp_reject')
                        .setLabel('🗑️ Reject')
                        .setStyle(ButtonStyle.Danger)
                        .setDisabled(!hasDefenses),
                    new ButtonBuilder()
                        .setCustomId('opp_approve_all')
                        .setLabel('✅ Approve All')
                        .setStyle(ButtonStyle.Success)
                        .setDisabled(!hasDefenses)
                );
                return [navRow, modeRow, actionRow];
            } else {
                const publishRow = new ActionRowBuilder().addComponents(
                    new ButtonBuilder()
                        .setCustomId('opp_publish')
                        .setLabel('📤 Publish All')
                        .setStyle(ButtonStyle.Success)
                        .setDisabled(!hasDefenses),
                    new ButtonBuilder()
                        .setCustomId('opp_remove_approved')
                        .setLabel('🗑️ Remove')
                        .setStyle(ButtonStyle.Danger)
                        .setDisabled(!hasDefenses),
                    new ButtonBuilder()
                        .setCustomId('opp_clear_all')
                        .setLabel('🗑️ Clear All')
                        .setStyle(ButtonStyle.Danger)
                        .setDisabled(!hasDefenses)
                );
                return [navRow, modeRow, publishRow];
            }
        };

        const { embed, files } = generateEmbed(0, viewMode);
        
        const response = await interaction.reply({
            embeds: [embed],
            files: files,
            components: generateButtons(0, viewMode),
            ephemeral: true,
            fetchReply: true
        });

        const collector = response.createMessageComponentCollector({ time: 600000 });

        collector.on('collect', async (i) => {
            try {
                // Navigation
                if (i.customId === 'opp_prev') {
                    currentIndex--;
                } else if (i.customId === 'opp_next') {
                    currentIndex++;
                } else if (i.customId === 'opp_refresh') {
                    pendingDefenses = getAllPendingOpponentDefenses();
                    approvedDefenses = getAllApprovedOpponentDefenses();
                    currentIndex = 0;
                }
                // View mode switch
                else if (i.customId === 'opp_view_pending') {
                    viewMode = 'pending';
                    currentIndex = 0;
                } else if (i.customId === 'opp_view_approved') {
                    viewMode = 'approved';
                    currentIndex = 0;
                }
                // Approve single
                else if (i.customId === 'opp_approve') {
                    const def = pendingDefenses[currentIndex];
                    if (def) {
                        await i.deferUpdate();
                        
                        const nextNum = getNextOpponentNumber();
                        const processedImage = await processOpponentImage(Buffer.from(def.image_data), nextNum);
                        approveOpponentDefense(def.id, processedImage, nextNum);
                        
                        pendingDefenses = getAllPendingOpponentDefenses();
                        approvedDefenses = getAllApprovedOpponentDefenses();
                        
                        if (currentIndex >= pendingDefenses.length && pendingDefenses.length > 0) {
                            currentIndex = pendingDefenses.length - 1;
                        } else if (pendingDefenses.length === 0) {
                            currentIndex = 0;
                        }
                        
                        const { embed: newEmbed, files: newFiles } = generateEmbed(currentIndex, viewMode);
                        await i.editReply({
                            content: `✅ Defense #${nextNum} approved!`,
                            embeds: [newEmbed],
                            files: newFiles,
                            components: generateButtons(currentIndex, viewMode)
                        });
                        return;
                    }
                }
                // Reject single
                else if (i.customId === 'opp_reject') {
                    const def = pendingDefenses[currentIndex];
                    if (def) {
                        rejectOpponentDefense(def.id);
                        pendingDefenses = getAllPendingOpponentDefenses();
                        
                        if (currentIndex >= pendingDefenses.length && pendingDefenses.length > 0) {
                            currentIndex = pendingDefenses.length - 1;
                        } else if (pendingDefenses.length === 0) {
                            currentIndex = 0;
                        }
                    }
                }
                // Approve all
                else if (i.customId === 'opp_approve_all') {
                    await i.deferUpdate();
                    
                    let count = 0;
                    for (const def of pendingDefenses) {
                        const nextNum = getNextOpponentNumber();
                        const processedImage = await processOpponentImage(Buffer.from(def.image_data), nextNum);
                        approveOpponentDefense(def.id, processedImage, nextNum);
                        count++;
                    }
                    
                    pendingDefenses = getAllPendingOpponentDefenses();
                    approvedDefenses = getAllApprovedOpponentDefenses();
                    currentIndex = 0;
                    
                    const { embed: newEmbed, files: newFiles } = generateEmbed(currentIndex, viewMode);
                    await i.editReply({
                        content: `✅ ${count} defenses approved!`,
                        embeds: [newEmbed],
                        files: newFiles,
                        components: generateButtons(currentIndex, viewMode)
                    });
                    return;
                }
                // Remove from approved
                else if (i.customId === 'opp_remove_approved') {
                    const def = approvedDefenses[currentIndex];
                    if (def) {
                        rejectOpponentDefense(def.id);
                        approvedDefenses = getAllApprovedOpponentDefenses();
                        
                        if (currentIndex >= approvedDefenses.length && approvedDefenses.length > 0) {
                            currentIndex = approvedDefenses.length - 1;
                        } else if (approvedDefenses.length === 0) {
                            currentIndex = 0;
                        }
                    }
                }
                // Clear all
                else if (i.customId === 'opp_clear_all') {
                    clearAllOpponentDefenses();
                    pendingDefenses = [];
                    approvedDefenses = [];
                    currentIndex = 0;
                }
                // Publish all approved
                else if (i.customId === 'opp_publish') {
                    // Show channel selection and season number modal
                    const modal = new ModalBuilder()
                        .setCustomId('opp_publish_modal')
                        .setTitle('Publish Opponents Defenses');

                    const channelInput = new TextInputBuilder()
                        .setCustomId('publish_channel')
                        .setLabel('Channel ID')
                        .setStyle(TextInputStyle.Short)
                        .setValue(process.env.PUBLISH_CHANNEL_ID || '')
                        .setPlaceholder('Right-click channel → Copy ID')
                        .setRequired(true);

                    const seasonInput = new TextInputBuilder()
                        .setCustomId('season_number')
                        .setLabel('Season Number (رقم الموسم)')
                        .setStyle(TextInputStyle.Short)
                        .setPlaceholder('157')
                        .setRequired(true);

                    const row1 = new ActionRowBuilder().addComponents(channelInput);
                    const row2 = new ActionRowBuilder().addComponents(seasonInput);
                    modal.addComponents(row1, row2);

                    await i.showModal(modal);
                    
                    try {
                        const modalSubmit = await i.awaitModalSubmit({ time: 60000 });
                        const channelId = modalSubmit.fields.getTextInputValue('publish_channel');
                        const seasonNumber = modalSubmit.fields.getTextInputValue('season_number');
                        
                        const channel = interaction.client.channels.cache.get(channelId);
                        if (!channel) {
                            await modalSubmit.reply({
                                content: '❌ Channel not found!',
                                ephemeral: true
                            });
                            return;
                        }

                        await modalSubmit.deferUpdate();
                        
                        // Send opening message
                        const openingMessage = `:RGR: **SEASON ${seasonNumber} EOS DEFENSES** :RGR:\n\nThese are some of the formations which people used end of season ${seasonNumber}. Big thanks to those who shared these forms.\n\n__Keep in mind to make some screenshots of the final day opponents defenses or record your arena run and screenshot the defenses from there afterwards.__\n\nYou can discuss the formations in the Regulators ⁠🧱-eos-discussion. Every form has a number, so you can easily refer to it.\n\n**If you would like the form to be discussed and tested, please react with a "👍".**\n\nIf you are testing some of the season ${seasonNumber} posted defense forms, please copy the **formation code** and add him under the picture as a **"thread"**. So people can easy copy & paste it for their own use. Thank you! 🙂`;
                        
                        await channel.send(openingMessage);
                        await channel.send('──────────────────────');
                        
                        // Publish all defenses
                        let publishedCount = 0;
                        const toPublish = getAllApprovedOpponentDefenses();
                        
                        for (const def of toPublish) {
                            try {
                                const imageData = def.processed_image || def.image_data;
                                const attachment = new AttachmentBuilder(
                                    Buffer.from(imageData),
                                    { name: `defense_${def.number}.png` }
                                );
                                
                                await channel.send({
                                    files: [attachment]
                                });
                                
                                markOpponentAsPublished(def.id);
                                publishedCount++;
                                
                                // Small delay to avoid rate limits
                                await new Promise(resolve => setTimeout(resolve, 500));
                            } catch (err) {
                                console.error(`Error publishing defense ${def.id}:`, err);
                            }
                        }
                        
                        // Send closing message
                        await channel.send('──────────────────────');
                        const closingMessage = `Due to the small amount of interesting defenses I had to pick from, we will most probably do less than the usual 10 top voted solutions.\n\n**Please keep in mind to make some screenshots of the final day opponents defenses or record your arena run and screenshot the defenses from there afterwards.**\n\n**Starts here**: ⁠🧱-eos-opponents-defenses`;
                        await channel.send(closingMessage);
                        
                        approvedDefenses = getAllApprovedOpponentDefenses();
                        currentIndex = 0;
                        
                        const { embed: newEmbed, files: newFiles } = generateEmbed(currentIndex, viewMode);
                        await modalSubmit.editReply({
                            content: `📤 **Published ${publishedCount} defenses to <#${channelId}>!**\n✅ Opening and closing messages sent!`,
                            embeds: [newEmbed],
                            files: newFiles,
                            components: generateButtons(currentIndex, viewMode)
                        });
                        return;
                    } catch (err) {
                        // Modal timeout
                    }
                    return;
                }

                // Update display
                const { embed: newEmbed, files: newFiles } = generateEmbed(currentIndex, viewMode);
                await i.update({
                    content: '',
                    embeds: [newEmbed],
                    files: newFiles,
                    components: generateButtons(currentIndex, viewMode)
                });
            } catch (error) {
                console.error('Error in opponents command:', error);
            }
        });
    }
};
