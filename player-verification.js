const ConfigRequirements = require("./config-requirements");
const Discord = require("discord.js");
const { ChannelType } = Discord;

class PlayerVerifier {
    constructor(pluginCtx) {
        this.pluginCtx = pluginCtx;
        this.codeMap = {};
        this.setup_player_verification(pluginCtx.omegga, pluginCtx.discordClient, pluginCtx.config);
    }

    setup_player_verification(omegga, discordClient, config) {
        let missing_reqs = ConfigRequirements.check_requirements(config, ["verify-timeout"]);
        if(missing_reqs.length !== 0) {
            throw "The following configs are required for player verification, but were not found:\n" + missing_reqs.toString();
        }

        if(config["verify-role-id"] && !config["guild-id"]) {
            throw "Error: verify-role-id requires guild-id";
        }

        if(config["verify-role-id"]) {
            this.give_initial_verifications(omegga, discordClient, config);
        }

        omegga.on("cmd:verify", (name) => {
            let code = generate_code();
            while (this.codeMap[code]) {
                code = generate_code();
            }
            this.codeMap[code] = name;
            setTimeout(() => {
                delete this.codeMap[code]
            }, config["verify-timeout"] * 60000);
            omegga.whisper(name, "To verify your in-game character, DM the following code to " + discordClient.user.username
                + " in the Discord server within the next " + config["verify-timeout"] + " minutes: " + code);
        });


        omegga.on("cmd:whois", (name, ...args) => {
            if(!args[0]) {
                omegga.whisper(name, "Usage: /whois playername");
                return;
            }

            let searchedName = args.join(" ");
            this.search_discord_id(searchedName)
                .then(results => {
                    if(results && Object.keys(results).length !== 0) {
                        let msg = "I found the following verified users that matched your search term:\n";
                        let promises = [];
                        for(let foundName in results) {
                            promises.push(discordClient.users.fetch(results[foundName])
                                .then(user => msg += foundName+" is verified on discord as @"+user.username+"\n")
                                .catch(reason => msg += "error retrieving account for "+foundName+": ("+reason+")\n"));
                        }
                        Promise.all(promises).then(() => omegga.whisper(name, msg)).catch(reason => omegga.whisper(
                            "failed to get search results: " + reason
                        ));
                    } else {
                        omegga.whisper(name, "No players matched your search term.");
                    }
                })
        });

        discordClient.on("messageCreate", msg => {
            if (msg.channel.type === ChannelType.DM && msg.author.id !== discordClient.user.id) {
                let match = msg.content.toString().match(/\d{4}/);
                if (match) {
                    let code = match[0];
                    let name = this.codeMap[code];
                    if (name) {
                        msg.reply("Hi, " + name + "! Saving your verification status...");
                        this.set(msg.author.id, name)
                            .then(() => {
                                if(config["verify-role-id"]) {
                                    return discordClient.guilds.fetch(config["guild-id"])
                                        .then(guild => guild.members.fetch(msg.author))
                                        .then(member => this.discord_side_verification(member, name, config));
                                }
                            })
                            .then(() => {
                                delete this.codeMap[code];
                                msg.reply("Thanks! Your character '" + name + "' has been verified!");
                            })
                            .catch(reason => msg.reply("Error verifying character: " + reason));
                    } else {
                        msg.reply("I couldn't find that verification code! Use /verify in-game to get a verification code.");
                    }
                } else {
                    msg.reply("I couldn't find a verification code in your message. Use /verify in-game to get a verification code.");
                }
            }
        });
    }

    set(discord_id, brickadia_name) {
        return this.pluginCtx.store.get("verified-players").then(verified_players => {
            verified_players.discord_to_brickadia[discord_id] = brickadia_name;
            verified_players.brickadia_to_discord[brickadia_name] = discord_id;
            return this.pluginCtx.store.set("verified-players", verified_players);
        }).catch(_ => {
            let verified_players = {brickadia_to_discord: {}, discord_to_brickadia: {}};
            verified_players.discord_to_brickadia[discord_id] = brickadia_name;
            verified_players.brickadia_to_discord[brickadia_name] = discord_id;
            return this.pluginCtx.store.set("verified-players", verified_players);
        });
    }

    fetch_discord_id(brickadia_name) {
        return this.pluginCtx.store.get("verified-players")
            .then(
                verified_players => verified_players.brickadia_to_discord[brickadia_name]
            );
    }

    search_discord_id(brickadia_name) {
        return this.pluginCtx.store.get("verified-players")
            .then(
                verified_players => best_guess(verified_players.brickadia_to_discord, brickadia_name)
            );
    }

    give_initial_verifications(omegga, discordClient, config) {
        this.pluginCtx.store.get("verified-players")
            .then(verified_players => {
                if(!verified_players) {
                  return;
                }
                let promises = [];
                for(let key in verified_players.discord_to_brickadia) {
                    let name = verified_players.discord_to_brickadia[key];
                    promises.push(discordClient.guilds.fetch(config["guild-id"])
                        .then(guild => guild.members.fetch(key))
                        .then(member => this.discord_side_verification(member, name, config))
                        .catch(reason => {
                            console.error("failed to grant role to player "+name+": "+reason);
                            if(reason.code === 10007) { // this is the code for an unknown member
                                delete verified_players.discord_to_brickadia[key];
                                delete verified_players.brickadia_to_discord[name];
                            }
                        }));
                }
                return Promise.all(promises).then(() => verified_players);
            })
            .then(verified_players => verified_players && this.pluginCtx.store.set("verified-players", verified_players))
            .catch(reason => console.error("Failed to grant verified roles: " + reason));
    }

    discord_side_verification(member, playerName, config) {
        let promise = Promise.resolve();
        if(config["verify-role-id"]) {
            promise = promise
                .then( () => member.roles.add(config["verify-role-id"]));
        }
        if(config["change-nick-on-verify"] && member.nickname !== playerName && member.manageable) {
            promise = promise
                .then( () => member.setNickname(playerName));
        }
        return promise;
    }
}

function best_guess(dict, searchTerm) {
    let results = {};
    for (let key in dict) {
        if(key.toString().toLowerCase().match(searchTerm.toLowerCase())) {
            results[key] = dict[key];
        }
    }
    return results;
}

function generate_code() {
    return getRandomInt(0, 10000).toString().padStart(4, "0");
}

function getRandomInt(min, max) {
    min = Math.ceil(min);
    max = Math.floor(max);
    return Math.floor(Math.random() * (max - min) + min); //The maximum is exclusive and the minimum is inclusive
}

module.exports = PlayerVerifier;
