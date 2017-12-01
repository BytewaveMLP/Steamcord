const Discord = require("discord.js");
const discord = new Discord.Client();

const Steam = require("steam-user");
const steam = new Steam({ enablePicsCache: true, picsCacheAll: true, changelistUpdateInterval: 5000 });

const fs = require("fs");

const settings = JSON.parse(fs.readFileSync("settings.json"));

const emojiStrip = require("emoji-strip");

var lastSender = null;

const webhook = new Discord.WebhookClient(settings.discord.hookID, settings.discord.hookSecret);

var masterGuild = null;

var expectingWebSession = false;

if( ! fs.existsSync("hooks.json") ){
	fs.writeFileSync("hooks.json", "{}");
}

var hooks = JSON.parse(fs.readFileSync("hooks.json"));

if( ! fs.existsSync("pics.json") ){
	fs.writeFileSync("pics.json", "{\"apps\": []}");
}

var pics = JSON.parse(fs.readFileSync("pics.json"));

var safeAppCall = false;

var resetTimeout = null;
var steamUpdateTimeout = null;

var newCommentNotifications = 0;
var newItemNotifications = 0;
var tradeOffers = 0;
var offlineMessages = 0;

function resolveCode(e, code){
	var res = "";

	Object.keys(e).forEach((v) => {
		if( e[v] == code ) res = v;
	});

	return res;
}

discord.on("ready", () => {
	masterGuild = discord.guilds.find("id", settings.discord.masterGuild);

	if( resetTimeout != null ) clearInterval(resetTimeout);

	resetTimeout = setInterval(() => {
		var greetings = [ "Hey, {{name}}!", "Hi, {{name}}!", "How's it going, {{name}}?", "How are you doing, {{name}}?", "What's up, {{name}}?", "What's new, {{name}}?", "How's everything, {{name}}?", "Great to see you, {{name}}!", "Good to see you, {{name}}!", "Nice to see you, {{name}}!", "Yo, {{name}}!", "Howdy, {{name}}!", "'Sup, {{name}}?", "Whazzup, {{name}}?", "Hiya, {{name}}!", "Aloha, {{name}}!", "Guten tag, {{name}}!", "Bonjour, {{name}}!", "Ni-hao, {{name}}!", "Hola, {{name}}!" ];

		var topic = "";
		if( steam.accountInfo == null ) topic+=greetings[Math.floor(Math.random()*greetings.length)].replace("{{name}}", "I have no name!");
		else topic+=greetings[Math.floor(Math.random()*greetings.length)].replace("{{name}}", steam.accountInfo.name);

		if( steam.wallet != null && steam.wallet.hasWallet ) topic+=" | $" + steam.wallet.balance;

		if( newCommentNotifications > 0 ) topic+=" | " + newCommentNotifications + " new comments";
		if( tradeOffers > 0 ) topic+=" | " + tradeOffers + " pending trade offers";
		if( newItemNotifications > 0 ) topic+=" | " + newItemNotifications + " new items";
		if( offlineMessages > 0 ) topic+=" | " + offlineMessages + " offline messages";
		if( ( pics.enabled || pics.apps.length > 0 ) && pics.cl ) topic+=" | Changelist " + pics.cl;
		masterGuild.channels.find("name", "general").setTopic(topic);
	}, 30000);

	if( steamUpdateTimeout != null ) clearInterval(steamUpdateTimeout);

	steamUpdateTimeout = setInterval(() => {
		var master = discord.users.find("id", settings.discord.master);

		var ps;

		switch(master.presence.status){
			case "online":
				ps = Steam.Steam.EPersonaState.Online;
				break;
			case "idle":
				ps = Steam.Steam.EPersonaState.Away;
				break;
			case "dnd":
				ps = Steam.Steam.EPersonaState.Busy;
				break;
			default:
				ps = Steam.Steam.EPersonaState.Snooze;
				break;
		}

		steam.setPersona(ps);

		if( master.presence.game !== null ){
			var gn = master.presence.game.name;
			if( master.presence.streaming ) gn = "Streaming " + gn;
			steam.gamesPlayed(gn);
		} else {
			steam.gamesPlayed([]);
		}
	}, 5000);

	console.log("Logged on to Discord.");
});

discord.on("message", (msg) => {
	if( msg.author.bot ) return;
	if( msg.author.id != settings.discord.master ) return;

	if( msg.content.startsWith("!") ){
		var mc = msg.content.slice(1).split(" ");

		if( mc[0] == "p" && mc.length >= 3 ){
			try{
				steam.chatMessage(mc[1], mc.slice(2).join(" "));
			} catch (err){
				msg.reply("that's not a valid Steam ID!");
			}
		} else if( mc[0] == "r" && mc.length >= 2 ){
			mc.slice(1).forEach((v,k) => {
				setTimeout(() => {
					steam.redeemKey(v, (r, d, p) => {
						var subs = [];
						if( p != null && typeof p == "object" ){
							Object.keys(p).forEach((v,k) => {
								subs.push(p[v] + " (" + v + ")");
							});
						}
						webhook.send("Key: " + v + " | Result: " + resolveCode(Steam.Steam.EResult, r) + " | Purchase information: " + resolveCode(Steam.EPurchaseResult, d) + " | Subs: " + subs.join(", "), { username: "Redeem Key", avatarURL: "https://eet.li/eb8e443.png" } );
					});
				}, k*5000);
			});
		} else if( mc[0] == "a" && mc.length >= 2 ){
			try{
				steam.addFriend(mc[1]);
			} catch (err){
				msg.reply("that's not a valid Steam ID!");
				return;
			}
			webhook.send("Added friend", { username: "Steam Friends", avatarURL: "https://eet.li/7fd7e03.png" });
		} else if( mc[0] == "f" ) {
			var friends = Object.keys(steam.myFriends);
			var i = 0;
			var embeds = [];

			friends.forEach((v,k) => {
				// blocked? don't care
				if( steam.myFriends[v] == Steam.Steam.EFriendRelationship.Ignored ){
					friends.splice(k, 1);
				}
			});

			var mFriends = friends.length;

			do {
				i++;

				var embed = new Discord.RichEmbed()
					.setColor(0x00AE86)
					.setAuthor("Steam Friend List", "https://eet.li/7fd7e03.png");

					var nicks = [];
					var steamids = [];
					var states = [];

					friends.forEach((v) => {
						var id = friends.shift()

						try {
							nicks.push(emojiStrip(steam.users[id].player_name));
						} catch(e) {
							nicks.push(id);
						}

						steamids.push(id);

						if( steam.myFriends[id] == Steam.Steam.EFriendRelationship.Friend ){
							if( steam.users[id].persona_state == Steam.Steam.EPersonaState.Offline ) states.push("Offline");
							else if( steam.users[id].persona_state == Steam.Steam.EPersonaState.Online ) states.push("Online");
							else if( steam.users[id].persona_state == Steam.Steam.EPersonaState.Busy ) states.push("Busy");
							else if( steam.users[id].persona_state == Steam.Steam.EPersonaState.Away ) states.push("Away");
							else if( steam.users[id].persona_state == Steam.Steam.EPersonaState.Snooze ) states.push("Snooze");
							else if( steam.users[id].persona_state == Steam.Steam.EPersonaState.LookingToPlay ) states.push("Looking to Play");
							else if( steam.users[id].persona_state == Steam.Steam.EPersonaState.LookingToTrade ) states.push("Looking to Trade");
							else states.push("Offline");
						} else {
							if( steam.myFriends[id] == Steam.Steam.EFriendRelationship.RequestRecipient ) states.push("Added you as a friend");
							else if ( steam.myFriends[id] == Steam.Steam.EFriendRelationship.Ignored ) states.push("Blocked");
							else states.push("??");
						}
					});

					nicks = nicks.join("\n");
					steamids = steamids.join("\n");
					states = states.join("\n");

					embed.addField("Persona Name", nicks, true);
					embed.addField("SteamID64", steamids, true);
					embed.addField("Status", states, true);

					embeds.push(embed);
			} while( friends.length > 25);

			webhook.send("", {username: "Steam Friends", avatarURL: "https://eet.li/7fd7e03.png", embeds: embeds } );
		} else if( mc[0] == "w" ) {
			expectingWebSession=true;
			steam.webLogOn();
		} else if( mc[0] == "p" ) {
			if( ! pics.enabled ) pics.enabled = true;
			else pics.enabled = false;

			fs.writeFileSync("pics.json", JSON.stringify(pics));

			webhook.send("PICS updates " + (pics.enabled ? "enabled" : "disabled") + ".", { username: "PICS", avatarURL: "https://eet.li/7fd7e03.png" });
		} else if( mc[0] == "q" ) {
			if( isNaN(parseInt(mc[1])) ) return webhook.send("Invalid AppID", { username: "PICS", avatarURL: "https://eet.li/7fd7e03.png"});

			var l = parseInt(mc[1]);

			if( pics.apps.indexOf(l) < 0 ) pics.apps.push(parseInt(mc[1]));
			else pics.apps.splice(pics.apps.indexOf(l), 1);

			fs.writeFileSync("pics.json", JSON.stringify(pics));

			webhook.send(((pics.apps.indexOf(l)) < 0 ? "No longer" : "Now") + " monitoring " + mc[1] + ".", { username: "PICS", avatarURL: "https://eet.li/7fd7e03.png"});
		} else if( mc[0] == "o" ){
			if( ! safeAppCall ) return webhook.send("Please wait one moment while Steamcord retrieves your apps.", { username: "Steamcord", avatarURL: "https://eet.li/7fd7e03.png"});
			if( isNaN(parseInt(mc[1])) ) return webhook.send("Invalid AppID", { username: "Steamcord", avatarURL: "https://eet.li/7fd7e03.png"});

			return webhook.send("You do" + ( steam.ownsApp(parseInt(mc[1])) ? "" : " not" ) + " own " + mc[1] + ".", { username: "Steamcord", avatarURL: "https://eet.li/7fd7e03.png"});
		} else {
			msg.reply("??");
		}
	} else {
		if( msg.channel.name != "general" ) steam.chatMessage(msg.channel.name, msg.content);
	}
});

discord.login(settings.discord.key);

steam.on("loggedOn", () => {
	steam.setPersona(Steam.Steam.EPersonaState.Online);
	console.log("Logged on to Steam.");
});

steam.on("friendMessage", (sender, message) => {
	if( masterGuild.channels.find("name", sender.toString()) === null ){
		masterGuild.createChannel(sender.toString(), "text").then((ch) => {
			ch.setTopic(steam.users[sender].player_name).then((ch) => {
				ch.createWebhook("Steam2Discord", "https://steamcdn-a.akamaihd.net/steamcommunity/public/images/avatars/f2/f2742c1750ecafc18c6c777ee4897accc61093e8_medium.jpg").then((webhook) => {
					hooks[sender] = {};
					hooks[sender].webhookID = webhook.id;
					hooks[sender].webhookToken = webhook.token;
					fs.writeFileSync("hooks.json", JSON.stringify(hooks));
					webhook.send(message, { username: steam.users[sender].player_name, avatarURL: steam.users[sender].avatar_url_full} );
					lastSender = sender;
				});
			});
		});
	} else {
		var hook = new Discord.WebhookClient(hooks[sender].webhookID, hooks[sender].webhookToken);

		masterGuild.channels.find("name", sender.toString()).setTopic(steam.users[sender].player_name);

		hook.send(message, {username: steam.users[sender].player_name, avatarURL: steam.users[sender].avatar_url_full});

		lastSender = sender;
	}
});

steam.on("friendRelationship", (sender, relationship) => {
	var msg = "";
	try {
		msg = steam.users[sender].player_name + " (" + sender + ") ";
	} catch(e){
		msg = sender + " ";
	}

	if( relationship == Steam.Steam.EFriendRelationship.None ){
		msg+= "❌ removed you.";
	} else if( relationship == Steam.Steam.EFriendRelationship.RequestRecipient ){
		msg+= "✅ sent a friend invite.";
	} else if( relationship == Steam.Steam.EFriendRelationship.Friend ){
		msg+= "✅ is now your friend.";
	} else if( relationship == Steam.Steam.EFriendRelationship.Ignored || relationship == Steam.Steam.EFriendRelationship.IgnoredFriend ){
		msg+="❌ ignored you.";
	} else if( relationship == Steam.Steam.EFriendRelationship.Blocked ){
		msg+="❌ blocked you.";
	}

	webhook.send(msg, { username: "Steam Friends", avatarURL: "https://eet.li/7fd7e03.png" });
});

steam.on("newItems", (count) => {
	newItemNotifications = count;
});

steam.on("newComments", (count) => {
	newCommentNotifications = count;
});

steam.on("tradeOffers", (count) => {
	tradeOffers = count;
});

steam.on("offlineMessages", (count) => {
	offlineMessages = count;
});

steam.on("webSession", (sessionid, cookies) => {
	if( expectingWebSession ){
		webhook.send(cookies.join("\n"), { username: "Steam Community", avatarURL: "https://eet.li/7fd7e03.png" });
		expectingWebSession = false;
	}
});

steam.on("appOwnershipCached", () => {
	safeAppCall = true;
});

steam.on("changelist", (cl, apps, subs) => {
	pics.cl = cl;
	fs.writeFileSync("pics.json", JSON.stringify(pics));

	var interested = false;

	apps.forEach((v) => {
		if( pics.apps.indexOf(v) > -1 ) interested = true;
	})

	if( pics.enabled || interested ){
		steam.getProductInfo(apps, subs, (apps, subs, unkApps, unkSubs) => {
			var msg = "Changelist " + cl + " | ";

			if( Object.keys(apps).length > 0 ){

				msg += Object.keys(apps).length + " apps: ";

				var m = [];

				Object.keys(apps).forEach((v) => {
					if( ! apps[v].appinfo.common ) m.push("Unknown App " + v);
					else m.push(apps[v].appinfo.common.name + " (" + v + ")");
				});

				msg += m.join(", ");

				if( (Object.keys(subs).length + Object.keys(unkSubs).length) > 0 ) msg+=" | ";

			}

			if( Object.keys(subs).length > 0 || Object.keys(unkSubs).length > 0 ){
				msg += (Object.keys(subs).length+Object.keys(unkSubs).length) + " subscriptions: ";

				var m = [];

				Object.keys(unkSubs).forEach((v) => {
					m.push(v);
				});

				Object.keys(subs).forEach((v) => {
					m.push(v);
				});

				msg += m.join(", ");
			}

			webhook.send(msg, { username: "PICS", avatarURL: "https://eet.li/7fd7e03.png" });
		});
	}
});

process.on("uncaughtException", (e) => {
	webhook.send("Uncaught exception: " + e, { username: "Steamcord", avatarURL: "https://eet.li/7fd7e03.png"});
});

steam.logOn(settings.steam);
