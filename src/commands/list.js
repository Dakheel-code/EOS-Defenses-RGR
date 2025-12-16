const { SlashCommandBuilder, ActionRowBuilder, ButtonBuilder, ButtonStyle, PermissionFlagsBits, AttachmentBuilder, ModalBuilder, TextInputBuilder, TextInputStyle } = require('discord.js');
const { getAllPendingSubmissions, deleteSubmission, updateSubmission, updateSubmissionMessage, markAsPublished, getArchivedSubmissions, restoreSubmission, deleteFromArchive } = require('../database');

const getIntroMessage = (season) => `@everyone

Defenses shared start here: ⁠🧱-s${season}-eos-defenses⁠

There's some good stuff here and it's great to see some new contributors with interesting ideas! 🫡 

These are strictly for use last 25 minutes only. 

Please add a 👍 or ✅  if you plan to use one and show your appreciation. ❤️`;

module.exports = {
    data: new SlashCommandBuilder()
        .setName('list')
        .setDescription('View and manage all pending submissions')
        .setDefaultMemberPermissions(PermissionFlagsBits.Administrator),

    async execute(interaction) {
        let submissions = getAllPendingSubmissions();

        let currentIndex = 0;
        let showFullCode = false;
        let seasonNumber = '158'; // Default season

        const generateMessage = (index, fullCode = false) => {
            // If no submissions, show empty state
            if (submissions.length === 0) {
                const embed = {
                    color: 0x808080,
                    title: '📭 No Pending Submissions',
                    description: 'There are no submissions waiting to be published.\n\nPlayers can send their defenses via DM to the bot.',
                    timestamp: new Date().toISOString()
                };
                return { embed, files: [], subId: null, code: null };
            }

            const sub = submissions[index];
            const files = [];
            
            const codePreview = sub.code.length > 100 
                ? `${sub.code.substring(0, 100)}...` 
                : sub.code;
            
            const embed = {
                color: 0x0099ff,
                title: `📋 Pending Submissions (${index + 1}/${submissions.length})`,
                fields: [
                    { name: '🆔 ID', value: `${sub.id}`, inline: true },
                    { name: '👤 Player', value: `<@${sub.user_id}>`, inline: true },
                    { name: '📛 Username', value: sub.username, inline: true },
                    { name: '💬 Message', value: sub.message || '_(empty)_', inline: false },
                    { name: '📝 Code (Thread)', value: fullCode ? `\`\`\`${sub.code}\`\`\`` : `\`${codePreview}\``, inline: false },
                    { name: '📅 Date', value: sub.created_at, inline: true }
                ],
                timestamp: new Date().toISOString()
            };

            if (sub.image_data) {
                const attachment = new AttachmentBuilder(
                    Buffer.from(sub.image_data),
                    { name: sub.image_filename || 'image.png' }
                );
                files.push(attachment);
                embed.image = { url: `attachment://${sub.image_filename || 'image.png'}` };
            }

            return { embed, files, subId: sub.id, code: sub.code };
        };

        const generateButtons = (index, fullCode = false) => {
            const hasSubmissions = submissions.length > 0;

            const navRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('list_prev')
                    .setLabel('◀️ Previous')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(!hasSubmissions || index === 0),
                new ButtonBuilder()
                    .setCustomId('list_next')
                    .setLabel('Next ▶️')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(!hasSubmissions || index === submissions.length - 1),
                new ButtonBuilder()
                    .setCustomId('toggle_code')
                    .setLabel(fullCode ? '🔽 Hide Code' : '🔼 Show Full Code')
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(!hasSubmissions),
                new ButtonBuilder()
                    .setCustomId('refresh_list')
                    .setLabel('🔄 Refresh')
                    .setStyle(ButtonStyle.Secondary)
            );

            const actionRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('edit_message')
                    .setLabel('✏️ Edit Message')
                    .setStyle(ButtonStyle.Primary)
                    .setDisabled(!hasSubmissions),
                new ButtonBuilder()
                    .setCustomId('edit_code')
                    .setLabel('📝 Edit Code')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(!hasSubmissions),
                new ButtonBuilder()
                    .setCustomId('delete_current')
                    .setLabel('🗑️ Delete')
                    .setStyle(ButtonStyle.Danger)
                    .setDisabled(!hasSubmissions),
                new ButtonBuilder()
                    .setCustomId('set_season')
                    .setLabel(`🏆 S${seasonNumber}`)
                    .setStyle(ButtonStyle.Secondary)
            );

            const publishRow = new ActionRowBuilder().addComponents(
                new ButtonBuilder()
                    .setCustomId('publish_all')
                    .setLabel('📤 Publish All')
                    .setStyle(ButtonStyle.Success)
                    .setDisabled(!hasSubmissions),
                new ButtonBuilder()
                    .setCustomId('schedule_menu')
                    .setLabel('⏰ Schedule')
                    .setStyle(ButtonStyle.Secondary)
                    .setDisabled(!hasSubmissions),
                new ButtonBuilder()
                    .setCustomId('view_archive')
                    .setLabel('📦 Archive')
                    .setStyle(ButtonStyle.Secondary)
            );

            return [navRow, actionRow, publishRow];
        };

        // Publish all submissions function
        const publishAllSubmissions = async () => {
            const channelId = process.env.PUBLISH_CHANNEL_ID;
            const channel = interaction.client.channels.cache.get(channelId);

            if (!channel) {
                return { success: false, error: 'Publish channel not found!' };
            }

            const subs = getAllPendingSubmissions();
            if (subs.length === 0) {
                return { success: false, error: 'No submissions to publish.' };
            }

            // Send intro message first
            await channel.send(getIntroMessage(seasonNumber));

            let publishedCount = 0;

            // Count submissions per user for numbering
            const userSubmissionCount = {};
            const userSubmissionIndex = {};
            for (const sub of subs) {
                userSubmissionCount[sub.user_id] = (userSubmissionCount[sub.user_id] || 0) + 1;
            }

            for (const sub of subs) {
                try {
                    // Track current index for this user
                    userSubmissionIndex[sub.user_id] = (userSubmissionIndex[sub.user_id] || 0) + 1;
                    
                    // Main message: mention + number (if multiple) + extra mention + message + image
                    let mainContent = `<@${sub.user_id}>`;
                    if (userSubmissionCount[sub.user_id] > 1) {
                        mainContent += ` - ${userSubmissionIndex[sub.user_id]}`;
                    }
                    if (sub.extra_mention) {
                        mainContent += ` <@${sub.extra_mention}>`;
                    }
                    if (sub.message) {
                        mainContent += `\n\n${sub.message}`;
                    }
                    
                    const messageOptions = {
                        content: mainContent
                    };

                    if (sub.image_data) {
                        const attachment = new AttachmentBuilder(
                            Buffer.from(sub.image_data),
                            { name: sub.image_filename || 'image.png' }
                        );
                        messageOptions.files = [attachment];
                    }

                    const sentMessage = await channel.send(messageOptions);

                    // Create thread with the code
                    const thread = await sentMessage.startThread({
                        name: 'Code',
                        autoArchiveDuration: 1440
                    });
                    await thread.send(sub.code);

                    markAsPublished(sub.id);
                    publishedCount++;

                    // Send DM thank you to the user
                    try {
                        const user = await interaction.client.users.fetch(sub.user_id);
                        await user.send(`🎉 **Your defense has been published!**\n\n🙏 Thank you for your contribution! Your defense is now live and helping the team!\n\n🔗 Check it out in <#${channelId}>`);
                    } catch (dmError) {
                        console.log(`Could not DM user ${sub.user_id}`);
                    }

                } catch (error) {
                    console.error(`Error publishing submission ${sub.id}:`, error);
                }
            }

            return { success: true, count: publishedCount };
        };

        const { embed, files } = generateMessage(0);
        
        const response = await interaction.reply({
            embeds: [embed],
            files: files,
            components: generateButtons(0),
            ephemeral: true,
            fetchReply: true
        });

        const collector = response.createMessageComponentCollector({ time: 600000 });

        collector.on('collect', async (i) => {
            if (i.customId === 'list_next') {
                currentIndex++;
                showFullCode = false;
            } else if (i.customId === 'list_prev') {
                currentIndex--;
                showFullCode = false;
            } else if (i.customId === 'toggle_code') {
                showFullCode = !showFullCode;
            } else if (i.customId === 'edit_message') {
                const currentSub = submissions[currentIndex];
                const modal = new ModalBuilder()
                    .setCustomId(`edit_message_modal_${currentSub.id}`)
                    .setTitle('Edit Main Message');

                const messageInput = new TextInputBuilder()
                    .setCustomId('new_message')
                    .setLabel('Message (appears with player mention)')
                    .setStyle(TextInputStyle.Paragraph)
                    .setValue(currentSub.message || '')
                    .setRequired(false)
                    .setPlaceholder('Optional message to show with the player mention');

                const mentionInput = new TextInputBuilder()
                    .setCustomId('extra_mention')
                    .setLabel('Extra Mention (User ID)')
                    .setStyle(TextInputStyle.Short)
                    .setValue(currentSub.extra_mention || '')
                    .setRequired(false)
                    .setPlaceholder('User ID to mention (right-click user → Copy ID)');

                const messageRow = new ActionRowBuilder().addComponents(messageInput);
                const mentionRow = new ActionRowBuilder().addComponents(mentionInput);
                modal.addComponents(messageRow, mentionRow);

                await i.showModal(modal);
                
                try {
                    const modalSubmit = await i.awaitModalSubmit({ time: 300000 });
                    const newMessage = modalSubmit.fields.getTextInputValue('new_message');
                    const extraMention = modalSubmit.fields.getTextInputValue('extra_mention');
                    updateSubmissionMessage(currentSub.id, newMessage, extraMention);
                    submissions = getAllPendingSubmissions();
                    
                    const { embed, files } = generateMessage(currentIndex, showFullCode);
                    await modalSubmit.update({
                        content: '✅ Message updated!',
                        embeds: [embed],
                        files: files,
                        components: generateButtons(currentIndex, showFullCode)
                    });
                } catch (err) {
                    // Modal timed out or was cancelled
                }
                return;
            } else if (i.customId === 'edit_code') {
                const currentSub = submissions[currentIndex];
                const modal = new ModalBuilder()
                    .setCustomId(`edit_code_modal_${currentSub.id}`)
                    .setTitle('Edit Code (Thread)');

                const codeInput = new TextInputBuilder()
                    .setCustomId('new_code')
                    .setLabel('Code (appears in thread)')
                    .setStyle(TextInputStyle.Paragraph)
                    .setValue(currentSub.code)
                    .setRequired(true);

                const actionRow = new ActionRowBuilder().addComponents(codeInput);
                modal.addComponents(actionRow);

                await i.showModal(modal);
                
                try {
                    const modalSubmit = await i.awaitModalSubmit({ time: 300000 });
                    const newCode = modalSubmit.fields.getTextInputValue('new_code');
                    updateSubmission(currentSub.id, newCode);
                    submissions = getAllPendingSubmissions();
                    
                    const { embed, files } = generateMessage(currentIndex, showFullCode);
                    await modalSubmit.update({
                        content: '✅ Code updated!',
                        embeds: [embed],
                        files: files,
                        components: generateButtons(currentIndex, showFullCode)
                    });
                } catch (err) {
                    // Modal timed out or was cancelled
                }
                return;
            } else if (i.customId === 'set_season') {
                const modal = new ModalBuilder()
                    .setCustomId('season_modal')
                    .setTitle('Set Season Number');

                const seasonInput = new TextInputBuilder()
                    .setCustomId('season_number')
                    .setLabel('Season Number')
                    .setStyle(TextInputStyle.Short)
                    .setValue(seasonNumber)
                    .setPlaceholder('158')
                    .setRequired(true)
                    .setMinLength(1)
                    .setMaxLength(5);

                const actionRow = new ActionRowBuilder().addComponents(seasonInput);
                modal.addComponents(actionRow);

                await i.showModal(modal);
                
                try {
                    const modalSubmit = await i.awaitModalSubmit({ time: 60000 });
                    seasonNumber = modalSubmit.fields.getTextInputValue('season_number');
                    
                    const { embed, files } = generateMessage(currentIndex, showFullCode);
                    await modalSubmit.update({
                        content: `🏆 **Season set to S${seasonNumber}**`,
                        embeds: [embed],
                        files: files,
                        components: generateButtons(currentIndex, showFullCode)
                    });
                } catch (err) {
                    // Modal timed out
                }
                return;
            } else if (i.customId === 'delete_current') {
                const currentSub = submissions[currentIndex];
                const deletedInfo = {
                    id: currentSub.id,
                    username: currentSub.username,
                    codePreview: currentSub.code.length > 50 ? currentSub.code.substring(0, 50) + '...' : currentSub.code,
                    date: currentSub.created_at
                };
                
                deleteSubmission(currentSub.id);
                submissions = getAllPendingSubmissions();
                
                const deleteEmbed = {
                    color: 0xff0000,
                    title: '🗑️ Submission Deleted!',
                    fields: [
                        { name: '📋 ID', value: `${deletedInfo.id}`, inline: true },
                        { name: '👤 Player', value: deletedInfo.username, inline: true },
                        { name: '📝 Code', value: `\`${deletedInfo.codePreview}\``, inline: false },
                        { name: '📅 Date', value: deletedInfo.date, inline: true }
                    ],
                    timestamp: new Date().toISOString()
                };
                
                if (submissions.length === 0) {
                    await i.update({
                        content: '📭 No more pending submissions.',
                        embeds: [deleteEmbed],
                        files: [],
                        components: []
                    });
                    return;
                }
                
                if (currentIndex >= submissions.length) {
                    currentIndex = submissions.length - 1;
                }
                showFullCode = false;
                
                // Send delete notification as followUp, then update with next submission
                await i.update({
                    content: '',
                    embeds: [deleteEmbed],
                    files: [],
                    components: []
                });
                
                // After 2 seconds, show the next submission
                setTimeout(async () => {
                    try {
                        const { embed: nextEmbed, files: nextFiles } = generateMessage(currentIndex, showFullCode);
                        await interaction.editReply({
                            content: '',
                            embeds: [nextEmbed],
                            files: nextFiles,
                            components: generateButtons(currentIndex, showFullCode)
                        });
                    } catch (err) {}
                }, 2000);
                return;
            } else if (i.customId === 'publish_all') {
                await i.deferUpdate();
                
                try {
                    const result = await publishAllSubmissions();
                    
                    if (result.success) {
                        await i.editReply({
                            content: `✅ **Published ${result.count} submissions successfully!**`,
                            embeds: [],
                            files: [],
                            components: []
                        });
                    } else {
                        await i.editReply({
                            content: `❌ ${result.error}`,
                            embeds: [],
                            files: [],
                            components: []
                        });
                    }
                } catch (error) {
                    console.error('Publish error:', error);
                    await i.editReply({
                        content: `❌ Error: ${error.message}`,
                        embeds: [],
                        files: [],
                        components: []
                    });
                }
                return;
            } else if (i.customId === 'schedule_menu') {
                // Get today's date in UTC
                const now = new Date();
                const todayUTC = now.toISOString().split('T')[0]; // YYYY-MM-DD
                const defaultChannelId = process.env.PUBLISH_CHANNEL_ID || '';

                const modal = new ModalBuilder()
                    .setCustomId('schedule_modal')
                    .setTitle('Schedule Publishing (UTC)');

                const channelInput = new TextInputBuilder()
                    .setCustomId('schedule_channel')
                    .setLabel('Channel ID (right-click channel → Copy ID)')
                    .setStyle(TextInputStyle.Short)
                    .setValue(defaultChannelId)
                    .setPlaceholder('1234567890123456789')
                    .setRequired(true)
                    .setMinLength(17)
                    .setMaxLength(20);

                const dateInput = new TextInputBuilder()
                    .setCustomId('schedule_date')
                    .setLabel('Date (YYYY-MM-DD) - UTC timezone')
                    .setStyle(TextInputStyle.Short)
                    .setValue(todayUTC)
                    .setPlaceholder('2025-12-15')
                    .setRequired(true)
                    .setMinLength(10)
                    .setMaxLength(10);

                const timeInput = new TextInputBuilder()
                    .setCustomId('schedule_time')
                    .setLabel('Time (HH:MM) - UTC timezone')
                    .setStyle(TextInputStyle.Short)
                    .setValue('22:30')
                    .setPlaceholder('22:30')
                    .setRequired(true)
                    .setMinLength(4)
                    .setMaxLength(5);

                const channelRow = new ActionRowBuilder().addComponents(channelInput);
                const dateRow = new ActionRowBuilder().addComponents(dateInput);
                const timeRow = new ActionRowBuilder().addComponents(timeInput);
                modal.addComponents(channelRow, dateRow, timeRow);

                await i.showModal(modal);
                
                try {
                    const modalSubmit = await i.awaitModalSubmit({ time: 60000 });
                    const channelId = modalSubmit.fields.getTextInputValue('schedule_channel');
                    const date = modalSubmit.fields.getTextInputValue('schedule_date');
                    const time = modalSubmit.fields.getTextInputValue('schedule_time');
                    
                    // Validate channel
                    const channel = interaction.client.channels.cache.get(channelId);
                    if (!channel) {
                        await modalSubmit.reply({
                            content: '❌ Channel not found! Make sure the Channel ID is correct.',
                            ephemeral: true
                        });
                        return;
                    }

                    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
                    const timeRegex = /^([01]?[0-9]|2[0-3]):([0-5][0-9])$/;
                    
                    if (!dateRegex.test(date)) {
                        await modalSubmit.reply({
                            content: '❌ Invalid date format! Use YYYY-MM-DD (e.g., 2025-12-15)',
                            ephemeral: true
                        });
                        return;
                    }

                    if (!timeRegex.test(time)) {
                        await modalSubmit.reply({
                            content: '❌ Invalid time format! Use HH:MM (e.g., 22:30)',
                            ephemeral: true
                        });
                        return;
                    }

                    const [hours, minutes] = time.split(':');
                    interaction.client.scheduler.setScheduleOnce(date, parseInt(hours), parseInt(minutes), channelId, seasonNumber);
                    
                    const { embed, files } = generateMessage(currentIndex, showFullCode);
                    await modalSubmit.update({
                        content: `⏰ **Scheduled for ${date} at ${time} UTC**\n📢 **Channel:** <#${channelId}>\n🌍 This is UTC timezone (Coordinated Universal Time)`,
                        embeds: [embed],
                        files: files,
                        components: generateButtons(currentIndex, showFullCode)
                    });
                } catch (err) {
                    // Modal timed out
                }
                return;
            }

            // View Archive
            if (i.customId === 'view_archive') {
                const archived = getArchivedSubmissions();
                if (archived.length === 0) {
                    await i.reply({
                        content: '📦 Archive is empty. No deleted or published submissions yet.',
                        ephemeral: true
                    });
                    return;
                }

                let archiveIndex = 0;

                const generateArchiveEmbed = (index) => {
                    const arch = archived[index];
                    const files = [];
                    const codePreview = arch.code.length > 100 
                        ? `${arch.code.substring(0, 100)}...` 
                        : arch.code;
                    
                    const reasonEmoji = arch.archive_reason === 'published' ? '✅' : '🗑️';
                    const reasonText = arch.archive_reason === 'published' ? 'Published' : 'Deleted';
                    
                    const embed = {
                        color: arch.archive_reason === 'published' ? 0x00ff00 : 0xff0000,
                        title: `📦 Archive (${index + 1}/${archived.length})`,
                        fields: [
                            { name: '🆔 Archive ID', value: `${arch.id}`, inline: true },
                            { name: '👤 Player', value: `<@${arch.user_id}>`, inline: true },
                            { name: `${reasonEmoji} Reason`, value: reasonText, inline: true },
                            { name: '📛 Username', value: arch.username, inline: true },
                            { name: '📝 Code', value: `\`${codePreview}\``, inline: false },
                            { name: '📅 Created', value: arch.created_at || 'N/A', inline: true },
                            { name: '📦 Archived', value: arch.archived_at || 'N/A', inline: true }
                        ],
                        timestamp: new Date().toISOString()
                    };

                    if (arch.image_data) {
                        const attachment = new AttachmentBuilder(
                            Buffer.from(arch.image_data),
                            { name: arch.image_filename || 'image.png' }
                        );
                        files.push(attachment);
                        embed.image = { url: `attachment://${arch.image_filename || 'image.png'}` };
                    }

                    return { embed, files };
                };

                const generateArchiveButtons = (index) => {
                    return [
                        new ActionRowBuilder().addComponents(
                            new ButtonBuilder()
                                .setCustomId('arch_prev')
                                .setLabel('◀️ Previous')
                                .setStyle(ButtonStyle.Secondary)
                                .setDisabled(index === 0),
                            new ButtonBuilder()
                                .setCustomId('arch_next')
                                .setLabel('Next ▶️')
                                .setStyle(ButtonStyle.Secondary)
                                .setDisabled(index === archived.length - 1),
                            new ButtonBuilder()
                                .setCustomId('arch_restore')
                                .setLabel('♻️ Restore')
                                .setStyle(ButtonStyle.Success),
                            new ButtonBuilder()
                                .setCustomId('arch_delete_permanent')
                                .setLabel('🗑️ Delete Forever')
                                .setStyle(ButtonStyle.Danger),
                            new ButtonBuilder()
                                .setCustomId('arch_close')
                                .setLabel('❌ Close')
                                .setStyle(ButtonStyle.Secondary)
                        )
                    ];
                };

                const { embed: archEmbed, files: archFiles } = generateArchiveEmbed(archiveIndex);
                const archiveReply = await i.reply({
                    embeds: [archEmbed],
                    files: archFiles,
                    components: generateArchiveButtons(archiveIndex),
                    ephemeral: true
                });

                const archCollector = archiveReply.createMessageComponentCollector({ time: 300000 });
                
                archCollector.on('collect', async (archI) => {
                    try {
                        if (archI.customId === 'arch_prev' && archiveIndex > 0) {
                            archiveIndex--;
                        } else if (archI.customId === 'arch_next' && archiveIndex < archived.length - 1) {
                            archiveIndex++;
                        } else if (archI.customId === 'arch_restore') {
                            const archiveId = archived[archiveIndex].id;
                            const result = restoreSubmission(archiveId);
                            if (result) {
                                submissions = getAllPendingSubmissions();
                                await archI.update({
                                    content: `♻️ **Restored!** Submission from **${result.username}** has been restored with new ID: **${result.newId}**`,
                                    embeds: [],
                                    files: [],
                                    components: []
                                });
                                return;
                            }
                        } else if (archI.customId === 'arch_delete_permanent') {
                            const archiveId = archived[archiveIndex].id;
                            const deletedUsername = archived[archiveIndex].username;
                            deleteFromArchive(archiveId);
                            
                            // Refresh archived list from database
                            const newArchived = getArchivedSubmissions();
                            archived.length = 0;
                            newArchived.forEach(a => archived.push(a));
                            
                            if (archived.length === 0) {
                                await archI.update({
                                    content: `🗑️ **Permanently deleted!** Submission from **${deletedUsername}** removed. Archive is now empty.`,
                                    embeds: [],
                                    files: [],
                                    components: []
                                });
                                return;
                            }
                            
                            if (archiveIndex >= archived.length) {
                                archiveIndex = archived.length - 1;
                            }
                            
                            const { embed: delEmbed, files: delFiles } = generateArchiveEmbed(archiveIndex);
                            await archI.update({
                                content: `🗑️ **Permanently deleted!** Submission from **${deletedUsername}** has been removed forever.`,
                                embeds: [delEmbed],
                                files: delFiles,
                                components: generateArchiveButtons(archiveIndex)
                            });
                            return;
                        } else if (archI.customId === 'arch_close') {
                            await archI.update({
                                content: '📦 Archive closed.',
                                embeds: [],
                                files: [],
                                components: []
                            });
                            return;
                        }

                        const { embed: newArchEmbed, files: newArchFiles } = generateArchiveEmbed(archiveIndex);
                        await archI.update({
                            embeds: [newArchEmbed],
                            files: newArchFiles,
                            components: generateArchiveButtons(archiveIndex)
                        });
                    } catch (err) {
                        console.error('Archive interaction error:', err);
                    }
                });

                return;
            }

            // Refresh list
            if (i.customId === 'refresh_list') {
                submissions = getAllPendingSubmissions();
                currentIndex = 0;
                showFullCode = false;
            }

            const { embed, files } = generateMessage(currentIndex, showFullCode);

            await i.update({
                embeds: [embed],
                files: files,
                components: generateButtons(currentIndex, showFullCode)
            });
        });
    }
};
