const { AttachmentBuilder } = require('discord.js');
const { getAllPendingSubmissions, markAsPublished } = require('./database');

const getIntroMessage = (season) => `@everyone

Defenses shared start here: ⁠🧱-s${season}-eos-defenses⁠

There's some good stuff here and it's great to see some new contributors with interesting ideas! 🫡 

These are strictly for use last 25 minutes only. 

Please add a 👍 or ✅  if you plan to use one and show your appreciation. ❤️`;

class Scheduler {
    constructor(client) {
        this.client = client;
        this.timeout = null;
        this.scheduledDate = null;
        this.scheduledTime = null;
        this.scheduledChannelId = null;
        this.scheduledSeason = '158';
    }

    setScheduleOnce(date, hour, minute, channelId, season) {
        if (this.timeout) {
            clearTimeout(this.timeout);
        }

        this.scheduledDate = date;
        this.scheduledTime = `${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}`;
        this.scheduledChannelId = channelId || process.env.PUBLISH_CHANNEL_ID;
        this.scheduledSeason = season || '158';

        // Calculate delay until scheduled time (UTC)
        const scheduledDateTime = new Date(`${date}T${this.scheduledTime}:00.000Z`);
        const now = new Date();
        const delay = scheduledDateTime.getTime() - now.getTime();

        if (delay <= 0) {
            console.log('Scheduled time is in the past!');
            return;
        }

        this.timeout = setTimeout(() => {
            this.publishAll();
            this.timeout = null;
            this.scheduledDate = null;
            this.scheduledTime = null;
            this.scheduledChannelId = null;
        }, delay);

        console.log(`Scheduler set for ${date} at ${this.scheduledTime} UTC to channel ${channelId} (in ${Math.round(delay / 1000 / 60)} minutes)`);
    }

    stop() {
        if (this.timeout) {
            clearTimeout(this.timeout);
            this.timeout = null;
        }
        this.scheduledDate = null;
        this.scheduledTime = null;
    }

    getStatus() {
        const active = this.timeout !== null;
        return { 
            active, 
            date: this.scheduledDate,
            time: this.scheduledTime
        };
    }

    async publishAll() {
        const channelId = this.scheduledChannelId || process.env.PUBLISH_CHANNEL_ID;
        const channel = this.client.channels.cache.get(channelId);

        if (!channel) {
            console.error('Publish channel not found!');
            return;
        }

        console.log('Starting scheduled publish...');

        const submissions = getAllPendingSubmissions();

        if (submissions.length === 0) {
            console.log('No submissions to publish.');
            return;
        }

        // Send intro message first
        await channel.send(getIntroMessage(this.scheduledSeason));

        // Count submissions per user for numbering
        const userSubmissionCount = {};
        const userSubmissionIndex = {};
        for (const sub of submissions) {
            userSubmissionCount[sub.user_id] = (userSubmissionCount[sub.user_id] || 0) + 1;
        }

        for (const sub of submissions) {
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
                console.log(`Published submission ${sub.id} from ${sub.username}`);

                // Send DM thank you to the user
                try {
                    const user = await this.client.users.fetch(sub.user_id);
                    await user.send(`🎉 **Your defense has been published!**\n\n🙏 Thank you for your contribution! Your defense is now live and helping the team!\n\n🔗 Check it out in <#${channelId}>`);
                } catch (dmError) {
                    console.log(`Could not DM user ${sub.user_id}`);
                }

            } catch (error) {
                console.error(`Error publishing submission ${sub.id}:`, error);
            }
        }

        console.log('Scheduled publish completed.');
    }
}

module.exports = Scheduler;
