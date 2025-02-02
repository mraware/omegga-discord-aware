const Discord = require("discord.js");
const ConfigRequirements = require("./config-requirements");

const sanitize = str => str
    // .replace(/&/g, '&')
    .replace(/\\\\/g, '\\')
    .replace(/;/g, '&scl;')
    .replace(/>/g, '&gt;')
    .replace(/_/g, '&und;')
    .replace(/</g, '&lt;')
    .replace(/"/g, '\\"');

function log_chats(omegga, discordClient, config) {
    // make sure all required config items are present
    let missing_reqs = ConfigRequirements.check_requirements(config, ["chat-channel-id"]);
    if(missing_reqs.length !== 0) {
        throw "The following configs are required for chat logging, but were not found:\n" + missing_reqs.toString();
    }

    discordClient.channels.fetch(config["chat-channel-id"]).then(chat_channel => {
        omegga.on("chat", (name, msg) => {
            let discord_msg = create_discord_chat_message(name, chat_channel, msg, config["compact-chat"]);
            chat_channel.send(discord_msg);
        });

        if(config["log-game-events"]) {
            omegga.on("line", logline => {
                let logChat = logline.match(/\[\d+\.\d+\.\d+-\d+\.\d+\.\d+:\d+\]\[[\s\d]+\]LogChat: (.*)/);
                if (logChat && logChat[1]) {
                    let msg = logChat[1];
                    // make sure this isn't a player chat message, in-game or from discord
                    let chat_match = msg.match(/(.*): .*/);
                    if (chat_match && (omegga.getPlayers().some(player => chat_match[1].includes(sanitize(player.name)))
                        || msg.includes("[discord]"))) {
                        return;
                    }
                    // also check it against the user defined screen
                    let whitelisted = msg.match(config["server-event-whitelist"]);
                    let blacklisted = msg.match(config["server-event-blacklist"]);
                    if (whitelisted && (!config["server-event-blacklist"] || !blacklisted)) {
                        chat_channel.send(msg);
                    }
                }
            });
        }
    }).catch(reason => {throw "failed to get chat channel: " + reason.toString()});
}

function create_discord_chat_message(name, channel, msg, compact) {
    let content;
    let embed;
    if(compact) {
        content = "**"+name+"**: "+msg;
    } else {
        embed = new Discord.EmbedBuilder().setAuthor(name).setDescription(msg);
    }
    return Discord.MessagePayload.create(channel, content,{embed: embed, disableMentions: "all"});
}

module.exports = log_chats;