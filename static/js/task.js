/*
 * Requires:
 *     psiturk.js
 *     utils.js
 * 	   game.js
 * 	   psiturk-pageblock-controller.js
 */


/*******************
 * PSITURK
 ******************/

// Set up PsiTurk
var psiTurk = new PsiTurk(uniqueId, adServerLoc, mode);

var pages = [
	"captcha.html",
	"postquestionnaire.html",
	"pageblock.html",
	"pageblock-dual-game-chat.html"
];

psiTurk.preloadPages(pages);

// UNCOMMENT THIS TO RUN EXPERIMENT 1
// const ConditionEnum = {
// 	0: {'communication': 'chat', 'concept_complexity': 1, 'visibility': 'full'},
// 	1: {'communication': 'chat', 'concept_complexity': 2, 'visibility': 'full'},
// 	2: {'communication': 'chat', 'concept_complexity': 3, 'visibility': 'full'},
// 	3: {'communication': 'demo', 'concept_complexity': 1, 'visibility': 'full'},
// 	4: {'communication': 'demo', 'concept_complexity': 2, 'visibility': 'full'},
// 	5: {'communication': 'demo', 'concept_complexity': 3, 'visibility': 'full'},
// };

// UNCOMMENT THIS TO RUN EXPERIMENT 2
const ConditionEnum = {
	0: {'communication': 'chat', 'concept_complexity': 1, 'visibility': 'full'},
	1: {'communication': 'chat', 'concept_complexity': 2, 'visibility': 'full'},
	2: {'communication': 'chat', 'concept_complexity': 1, 'visibility': 'partial'},
	3: {'communication': 'chat', 'concept_complexity': 2, 'visibility': 'partial'},
	4: {'communication': 'demo', 'concept_complexity': 1, 'visibility': 'full'},
	5: {'communication': 'demo', 'concept_complexity': 2, 'visibility': 'full'},
	6: {'communication': 'demo', 'concept_complexity': 1, 'visibility': 'partial'},
	7: {'communication': 'demo', 'concept_complexity': 2, 'visibility': 'partial'},
};

let clientIsTeacher = false;
let reliantOnPartner = false; 	// Do we need a socket connection at this stage?
let partnerPairCondition; // Variable we'll actually use for the experiment if paired
let multiplayerAdvanceDelaySeconds = 7;

let initialPartnerPairCondition = ConditionEnum[condition];
initialPartnerPairCondition['counterbalance'] = Math.floor(Math.random() * 48); // Don't rely on Pturk for this.
// See https://groups.google.com/g/psiturk/c/JwXWtF2uf1Y

// Experiment constants
initialPartnerPairCondition['teacher'] = 'human';
initialPartnerPairCondition['learner'] = 'human';

/*******************
 * CHAT SERVER
 ******************/

// Set up chat server
let HOST = "https://radiant-spire-47145.herokuapp.com".replace(/^http/, "ws");
let gameserverio = new GameServerIO({HOST});

var gameserver_client_id;
var gameserver_partner_id;

gameserverio.set_message_callback((msg) => {

	// Only read messages our partner sent-- don't read back our own messages
	if (msg['client_number'] !== gameserver_client_id) {

		let payload;

		// If we get an error on parsing, log the full message
		try {
			payload = JSON.parse(msg['data']);
		} catch (e) {
			console.log("ERROR reading message (JSON parse failed)");
			console.log(e);
			console.log(msg);
		}

		if (payload['name'] === "experiment_condition") {
			// Sent from teacher --> player on pairing, determines conditions for this experiment.

			// Unpack payload information into this client's namespace
			partnerPairCondition = payload["condition"];

			let pairUUID = uniqueId + payload["teacher_uuid"];
			partnerPairCondition["pair_uuid"] = pairUUID;

				// Add in this player's info
			payload["learner_uuid"] = uniqueId;
			payload["pair_uuid"] = pairUUID;
			payload["name"] = "pairing_configuration";

			overwritePsiTurkConditionNumber(payload["teacher_condition_number"]);

			// Log to Psiturk
			psiTurk.recordTrialData(payload);
			psiTurk.saveData();

		} else if (payload['name'] === "partner_disconnect") {

			console.log("Recieved partner disconnect message: " + payload);

			// Wait 15 seconds-- if we're *still* reliant on partner, i.e. haven't advanced to survey...
			// Then disconnect and end experiment.
			setTimeout(function () {

				if (reliantOnPartner) {
				// Badness. We've lost our partner when we still needed them.

					// Don't count this person towards this condition. Instead, overwrite their condition to 99.
					overwritePsiTurkConditionNumber(99);

					// Close our socket, since we're done here.
					gameserverio.socket.close();

					// Tell them about the badness :(
					$("#pageblock-dual-title").html(`<h2>Partner Disconnected!</h2>`);
					$("#instructions-top").html(`We apologize! Ending HIT early and paying out your bonus. <br /><br />`);
					$("#instructions-bottom").hide();
					$("#left-game-window").hide();
					$("#chat-ui").hide();
					$("#chat-nav").hide();
					$("#right-game-window").hide();
					$("#score-box").hide();
					$("#multiplayer-nav").hide();

					psiTurk.recordUnstructuredData('partner_disconnected', payload['reason']);

					// Give them a few seconds to ponder, then end the HIT.
					setTimeout(function () {
						finish();
					}, 7000);

				}

			}, 10000);

		} else if (payload['name'] === "full_game_record") {
			// Game record to be logged to PsiTurk. Sent from:
			// 1. Learner --> teacher (for bonus calc)

			// Update our running score display if needed
			updateScoreBox(payload);

			// We don't need player locations, which is a big field, so delete it
			delete payload.player_locations;
			console.log("Received full game record from partner; logging summary:");
			console.log(payload);

			// If we're the teacher, we need this for bonus calc so save it ASAP, just in case.
			psiTurk.recordTrialData(payload);
			psiTurk.saveData();

		} else if (payload['name'] === "enable_chat") {
			// Sent from learner --> teacher in "chat" conditions to enable chat UI.

			$("#instructions-bottom").html(`<strong>Chat enabled!</strong> Message your partner, then click Continue when ready.`);
			$("#chat-box").show();
			$("#chat-send").show();

		} else if (payload['name'] === "next_page") {
			// Instruction from partner to advance screens

			$("#instructions-bottom").html(
				`<p><strong>Partner advanced. Loading next level<span id="ellipses">...</span></strong></p>`
			);
			let ellipses = setInterval(function () {
				var e = $("#ellipses").text();
				$("#ellipses").text(".".repeat((e.length+1) % 10));
			}, 500);

			// Tell any live Phaser instances to shut down
			let level_end_msg = {"name": "game_event", "event": "level_end", "level_number": currentLevelNumber};
			gameMessageQueue.push(level_end_msg);

			if (typeof payload["delay_seconds"] == 'undefined') {
				clearInterval(ellipses);
				$('#next').click();
			} else {
				setTimeout(() => {
					clearInterval(ellipses);
					$('#next').click();
				}, payload["delay_seconds"] * 1000);
			}

		} else if (payload['name'] === "chat_message") {
			// Sent from teacher --> learner during chat phase.

			$('#chat-messages').append($('<li>').text(payload['chat']));

			// Add in current level / experiment info and log to PsiTurk
			let psiturkChatLog = Object.assign({}, payload, partnerPairCondition);
			psiturkChatLog["level_number"] = currentLevelNumber;
			psiturkChatLog["task_uuid"] = uniqueId;
			psiTurk.recordTrialData(psiturkChatLog);

		} else {

			// The default: game info sent from the active player to the observer.
			gameMessageQueue.push(payload);

		}

	}

});

function overwritePsiTurkConditionNumber(newConditionNumber) {

	let psiTurkConditionOverwriteData = {"uniqueId": uniqueId, "new_cond": newConditionNumber};

	// Ajax call to overwrite this player's condition in the PsiTurk database
	$.ajax("set_condition", {
		type: "GET",
		data: psiTurkConditionOverwriteData,
		success: function (data) {
			console.log(data);
		}
	});

}

/*******************
 * GAMEPLAY CONFIGURATION
 ******************/

let currentLevelNumber;
let currentScore = 0;
let totalPossiblePoints = 0;
let currentBonusCents = 0;
let totalPossibleBonusCents = 175; // in cents

let gameMessageQueue = [];
let chatMessageQueue = [];

// Value mask to override the actual concept display and instead show gray squares with point values.
let graySquareValueMask = {
	"objectShape": "blankSquare",
	"objectTint": "0x555555",
	"text": {"key": "value", "color": "intuitive_red_green"}
};

/*******************
 * BOARDS
 ******************/

// Board configurations
const practiceRounds = [{"game_metadata": {"name": "boolean1.0_practice", "level_duration_seconds": 8, "max_abs_value": 10, "min_abs_value": 1, "grid_size": 75, "player_size": 5, "object_size": 3, "object_padding": 7, "cluster_width": 20, "ratio_negative_to_zero": 0.7, "uuid": "1420a1e9-ef11-468b-aefd-ae50165dbd7c", "level_number": 1, "max_cluster_value": 4, "cluster_configs": [{"centroid": [11, 11], "pos_objects": 4, "num_objects": 4, "id": 1, "actual_positive_value": 4, "actual_negative_value": 0}, {"centroid": [64, 11], "pos_objects": 3, "num_objects": 3, "id": 2, "actual_positive_value": 3, "actual_negative_value": 0}]}, "frame_data": {"objects": [{"x": 5, "y": 15, "value": 1, "mask_value": 3, "cluster_id": 1, "objectTint": "0x555555", "objectShape": "blankSquare"}, {"x": 15, "y": 15, "value": 1, "mask_value": 1, "cluster_id": 1, "objectTint": "0x555555", "objectShape": "blankSquare"}, {"x": 16, "y": 5, "value": 1, "mask_value": 0, "cluster_id": 1, "objectTint": "0x555555", "objectShape": "blankSquare"}, {"x": 9, "y": 3, "value": 1, "mask_value": 3, "cluster_id": 1, "objectTint": "0x555555", "objectShape": "blankSquare"}, {"x": 67, "y": 11, "value": 1, "mask_value": 2, "cluster_id": 2, "objectTint": "0x555555", "objectShape": "blankSquare"}, {"x": 58, "y": 11, "value": 1, "mask_value": 1, "cluster_id": 2, "objectTint": "0x555555", "objectShape": "blankSquare"}, {"x": 63, "y": 18, "value": 1, "mask_value": 2, "cluster_id": 2, "objectTint": "0x555555", "objectShape": "blankSquare"}], "player": {"x": 38, "y": 38}, "score": 0, "ms_elapsed": 0}}, {"game_metadata": {"name": "boolean1.0_practice", "level_duration_seconds": 8, "max_abs_value": 10, "min_abs_value": 1, "grid_size": 75, "player_size": 5, "object_size": 3, "object_padding": 7, "cluster_width": 20, "ratio_negative_to_zero": 0.7, "uuid": "9f263746-853a-4ddd-b82e-9556c675e181", "level_number": 2, "max_cluster_value": 2, "cluster_configs": [{"centroid": [11, 11], "pos_objects": 2, "num_objects": 5, "id": 1, "actual_positive_value": 2, "actual_negative_value": -3}, {"centroid": [11, 64], "pos_objects": 2, "num_objects": 5, "id": 2, "actual_positive_value": 2, "actual_negative_value": -3}]}, "frame_data": {"objects": [{"x": 8, "y": 9, "value": 1, "mask_value": 0, "cluster_id": 1, "objectTint": "0x555555", "objectShape": "blankSquare"}, {"x": 14, "y": 8, "value": 1, "mask_value": 3, "cluster_id": 1, "objectTint": "0x555555", "objectShape": "blankSquare"}, {"x": 7, "y": 15, "value": -1, "mask_value": 0, "cluster_id": 1, "objectTint": "0x555555", "objectShape": "blankSquare"}, {"x": 18, "y": 17, "value": -1, "mask_value": 3, "cluster_id": 1, "objectTint": "0x555555", "objectShape": "blankSquare"}, {"x": 7, "y": 3, "value": -1, "mask_value": 0, "cluster_id": 1, "objectTint": "0x555555", "objectShape": "blankSquare"}, {"x": 17, "y": 63, "value": 1, "mask_value": 3, "cluster_id": 2, "objectTint": "0x555555", "objectShape": "blankSquare"}, {"x": 11, "y": 56, "value": 1, "mask_value": 3, "cluster_id": 2, "objectTint": "0x555555", "objectShape": "blankSquare"}, {"x": 4, "y": 59, "value": -1, "mask_value": 3, "cluster_id": 2, "objectTint": "0x555555", "objectShape": "blankSquare"}, {"x": 14, "y": 71, "value": -1, "mask_value": 1, "cluster_id": 2, "objectTint": "0x555555", "objectShape": "blankSquare"}, {"x": 8, "y": 66, "value": -1, "mask_value": 1, "cluster_id": 2, "objectTint": "0x555555", "objectShape": "blankSquare"}], "player": {"x": 38, "y": 38}, "score": 0, "ms_elapsed": 0}}, {"game_metadata": {"name": "boolean1.0_practice", "level_duration_seconds": 8, "max_abs_value": 10, "min_abs_value": 1, "grid_size": 75, "player_size": 5, "object_size": 3, "object_padding": 7, "cluster_width": 20, "ratio_negative_to_zero": 0.7, "uuid": "f6308e6f-e87b-497f-9dc8-7ae48e4b86c5", "level_number": 3, "max_cluster_value": 3, "cluster_configs": [{"centroid": [11, 11], "pos_objects": 3, "num_objects": 5, "id": 1, "actual_positive_value": 3, "actual_negative_value": -2}, {"centroid": [64, 64], "pos_objects": 2, "num_objects": 5, "id": 2, "actual_positive_value": 2, "actual_negative_value": -3}]}, "frame_data": {"objects": [{"x": 7, "y": 18, "value": 1, "mask_value": 2, "cluster_id": 1, "objectTint": "0x0000FF", "objectShape": "blankCircle"}, {"x": 17, "y": 17, "value": 1, "mask_value": 0, "cluster_id": 1, "objectTint": "0x0000FF", "objectShape": "blankCircle"}, {"x": 18, "y": 10, "value": 1, "mask_value": 1, "cluster_id": 1, "objectTint": "0x0000FF", "objectShape": "blankCircle"}, {"x": 12, "y": 8, "value": -1, "mask_value": 3, "cluster_id": 1, "objectTint": "0xFF0000", "objectShape": "blankSquare"}, {"x": 4, "y": 7, "value": -1, "mask_value": 0, "cluster_id": 1, "objectTint": "0xFF0000", "objectShape": "blankSquare"}, {"x": 64, "y": 60, "value": 1, "mask_value": 3, "cluster_id": 2, "objectTint": "0x0000FF", "objectShape": "blankCircle"}, {"x": 56, "y": 64, "value": 1, "mask_value": 0, "cluster_id": 2, "objectTint": "0x0000FF", "objectShape": "blankCircle"}, {"x": 69, "y": 66, "value": -1, "mask_value": 0, "cluster_id": 2, "objectTint": "0xFF0000", "objectShape": "blankSquare"}, {"x": 57, "y": 56, "value": -1, "mask_value": 0, "cluster_id": 2, "objectTint": "0xFF0000", "objectShape": "blankSquare"}, {"x": 58, "y": 70, "value": -1, "mask_value": 2, "cluster_id": 2, "objectTint": "0xFF0000", "objectShape": "blankSquare"}], "player": {"x": 38, "y": 38}, "score": 0, "ms_elapsed": 0}}, {"game_metadata": {"name": "boolean1.0_practice", "level_duration_seconds": 8, "max_abs_value": 10, "min_abs_value": 1, "grid_size": 75, "player_size": 5, "object_size": 3, "object_padding": 7, "cluster_width": 20, "ratio_negative_to_zero": 0.7, "uuid": "9a587936-f06b-4fbd-a0b2-1c853736f15a", "level_number": 4, "max_cluster_value": 5, "cluster_configs": [{"centroid": [11, 11], "pos_objects": 3, "num_objects": 5, "id": 1, "actual_positive_value": 3, "actual_negative_value": -2}, {"centroid": [64, 11], "pos_objects": 3, "num_objects": 5, "id": 2, "actual_positive_value": 3, "actual_negative_value": -2}, {"centroid": [64, 64], "pos_objects": 5, "num_objects": 5, "id": 3, "actual_positive_value": 5, "actual_negative_value": 0}, {"centroid": [11, 64], "pos_objects": 2, "num_objects": 5, "id": 4, "actual_positive_value": 2, "actual_negative_value": -3}]}, "frame_data": {"objects": [{"x": 15, "y": 18, "value": 1, "mask_value": 2, "cluster_id": 1, "objectTint": "0x0000FF", "objectShape": "blankCircle"}, {"x": 8, "y": 14, "value": 1, "mask_value": 3, "cluster_id": 1, "objectTint": "0x0000FF", "objectShape": "blankCircle"}, {"x": 13, "y": 4, "value": 1, "mask_value": 3, "cluster_id": 1, "objectTint": "0x0000FF", "objectShape": "blankCircle"}, {"x": 3, "y": 4, "value": -1, "mask_value": 2, "cluster_id": 1, "objectTint": "0xFF0000", "objectShape": "blankSquare"}, {"x": 17, "y": 10, "value": -1, "mask_value": 1, "cluster_id": 1, "objectTint": "0xFF0000", "objectShape": "blankSquare"}, {"x": 68, "y": 12, "value": 1, "mask_value": 1, "cluster_id": 2, "objectTint": "0x0000FF", "objectShape": "blankCircle"}, {"x": 59, "y": 6, "value": 1, "mask_value": 1, "cluster_id": 2, "objectTint": "0x0000FF", "objectShape": "blankCircle"}, {"x": 58, "y": 17, "value": 1, "mask_value": 0, "cluster_id": 2, "objectTint": "0x0000FF", "objectShape": "blankCircle"}, {"x": 68, "y": 18, "value": -1, "mask_value": 2, "cluster_id": 2, "objectTint": "0xFF0000", "objectShape": "blankSquare"}, {"x": 68, "y": 6, "value": -1, "mask_value": 3, "cluster_id": 2, "objectTint": "0xFF0000", "objectShape": "blankSquare"}, {"x": 61, "y": 56, "value": 1, "mask_value": 3, "cluster_id": 3, "objectTint": "0x0000FF", "objectShape": "blankCircle"}, {"x": 64, "y": 63, "value": 1, "mask_value": 0, "cluster_id": 3, "objectTint": "0x0000FF", "objectShape": "blankCircle"}, {"x": 61, "y": 71, "value": 1, "mask_value": 3, "cluster_id": 3, "objectTint": "0x0000FF", "objectShape": "blankCircle"}, {"x": 69, "y": 69, "value": 1, "mask_value": 1, "cluster_id": 3, "objectTint": "0x0000FF", "objectShape": "blankCircle"}, {"x": 58, "y": 64, "value": 1, "mask_value": 0, "cluster_id": 3, "objectTint": "0x0000FF", "objectShape": "blankCircle"}, {"x": 11, "y": 68, "value": 1, "mask_value": 0, "cluster_id": 4, "objectTint": "0x0000FF", "objectShape": "blankCircle"}, {"x": 4, "y": 63, "value": 1, "mask_value": 3, "cluster_id": 4, "objectTint": "0x0000FF", "objectShape": "blankCircle"}, {"x": 4, "y": 57, "value": -1, "mask_value": 3, "cluster_id": 4, "objectTint": "0xFF0000", "objectShape": "blankSquare"}, {"x": 14, "y": 61, "value": -1, "mask_value": 1, "cluster_id": 4, "objectTint": "0xFF0000", "objectShape": "blankSquare"}, {"x": 17, "y": 70, "value": -1, "mask_value": 3, "cluster_id": 4, "objectTint": "0xFF0000", "objectShape": "blankSquare"}], "player": {"x": 38, "y": 38}, "score": 0, "ms_elapsed": 0}}];

const gameplayRounds = [{"frame_data": {"ms_elapsed": 0, "objects": [{"cluster_id": 1, "mask_value": 1, "value": 1, "x": 5, "y": 3}, {"cluster_id": 1, "mask_value": 0, "value": 1, "x": 10, "y": 14}, {"cluster_id": 1, "mask_value": 3, "value": 1, "x": 18, "y": 13}, {"cluster_id": 1, "mask_value": 3, "value": 1, "x": 3, "y": 12}, {"cluster_id": 1, "mask_value": 0, "value": -1, "x": 14, "y": 4}, {"cluster_id": 2, "mask_value": 1, "value": 1, "x": 68, "y": 10}, {"cluster_id": 2, "mask_value": 0, "value": 1, "x": 61, "y": 5}, {"cluster_id": 2, "mask_value": 3, "value": 1, "x": 66, "y": 17}, {"cluster_id": 2, "mask_value": 2, "value": -1, "x": 58, "y": 13}, {"cluster_id": 2, "mask_value": 0, "value": -1, "x": 71, "y": 3}, {"cluster_id": 3, "mask_value": 2, "value": 1, "x": 63, "y": 65}, {"cluster_id": 3, "mask_value": 1, "value": -1, "x": 71, "y": 64}, {"cluster_id": 3, "mask_value": 2, "value": -1, "x": 56, "y": 71}, {"cluster_id": 3, "mask_value": 1, "value": -1, "x": 64, "y": 56}, {"cluster_id": 3, "mask_value": 1, "value": -1, "x": 56, "y": 64}, {"cluster_id": 4, "mask_value": 2, "value": 1, "x": 10, "y": 70}, {"cluster_id": 4, "mask_value": 3, "value": 1, "x": 7, "y": 60}, {"cluster_id": 4, "mask_value": 3, "value": 1, "x": 18, "y": 70}, {"cluster_id": 4, "mask_value": 0, "value": 1, "x": 16, "y": 62}, {"cluster_id": 4, "mask_value": 0, "value": -1, "x": 3, "y": 70}], "player": {"x": 38, "y": 38}, "score": 0}, "game_metadata": {"cluster_configs": [{"actual_negative_value": -1, "actual_positive_value": 4, "centroid": [11, 11], "id": 1, "num_objects": 5, "pos_objects": 4}, {"actual_negative_value": -2, "actual_positive_value": 3, "centroid": [64, 11], "id": 2, "num_objects": 5, "pos_objects": 3}, {"actual_negative_value": -4, "actual_positive_value": 1, "centroid": [64, 64], "id": 3, "num_objects": 5, "pos_objects": 1}, {"actual_negative_value": -1, "actual_positive_value": 4, "centroid": [11, 64], "id": 4, "num_objects": 5, "pos_objects": 4}], "cluster_width": 20, "grid_size": 75, "level_duration_seconds": 8, "level_number": 1, "max_cluster_value": 4, "name": "boolean_1.0", "object_padding": 7, "object_size": 3, "player_size": 5, "uuid": "a419773b-19e6-460d-848a-0ecf2ab477dc"}}, {"frame_data": {"ms_elapsed": 0, "objects": [{"cluster_id": 1, "mask_value": 3, "value": 1, "x": 17, "y": 18}, {"cluster_id": 1, "mask_value": 1, "value": 1, "x": 12, "y": 9}, {"cluster_id": 1, "mask_value": 3, "value": 1, "x": 5, "y": 10}, {"cluster_id": 1, "mask_value": 3, "value": -1, "x": 6, "y": 18}, {"cluster_id": 1, "mask_value": 2, "value": -1, "x": 4, "y": 3}, {"cluster_id": 2, "mask_value": 0, "value": 1, "x": 62, "y": 11}, {"cluster_id": 2, "mask_value": 0, "value": 1, "x": 60, "y": 4}, {"cluster_id": 2, "mask_value": 0, "value": 1, "x": 69, "y": 13}, {"cluster_id": 2, "mask_value": 3, "value": 1, "x": 68, "y": 3}, {"cluster_id": 2, "mask_value": 0, "value": -1, "x": 58, "y": 18}, {"cluster_id": 3, "mask_value": 0, "value": 1, "x": 62, "y": 66}, {"cluster_id": 3, "mask_value": 1, "value": 1, "x": 63, "y": 59}, {"cluster_id": 3, "mask_value": 3, "value": 1, "x": 71, "y": 62}, {"cluster_id": 3, "mask_value": 0, "value": 1, "x": 56, "y": 58}, {"cluster_id": 3, "mask_value": 1, "value": 1, "x": 71, "y": 70}, {"cluster_id": 4, "mask_value": 0, "value": -1, "x": 15, "y": 61}, {"cluster_id": 4, "mask_value": 3, "value": -1, "x": 5, "y": 60}, {"cluster_id": 4, "mask_value": 0, "value": -1, "x": 11, "y": 68}, {"cluster_id": 4, "mask_value": 3, "value": -1, "x": 18, "y": 71}, {"cluster_id": 4, "mask_value": 3, "value": -1, "x": 3, "y": 68}], "player": {"x": 38, "y": 38}, "score": 0}, "game_metadata": {"cluster_configs": [{"actual_negative_value": -2, "actual_positive_value": 3, "centroid": [11, 11], "id": 1, "num_objects": 5, "pos_objects": 3}, {"actual_negative_value": -1, "actual_positive_value": 4, "centroid": [64, 11], "id": 2, "num_objects": 5, "pos_objects": 4}, {"actual_negative_value": 0, "actual_positive_value": 5, "centroid": [64, 64], "id": 3, "num_objects": 5, "pos_objects": 5}, {"actual_negative_value": -5, "actual_positive_value": 0, "centroid": [11, 64], "id": 4, "num_objects": 5, "pos_objects": 0}], "cluster_width": 20, "grid_size": 75, "level_duration_seconds": 8, "level_number": 2, "max_cluster_value": 5, "name": "boolean_1.0", "object_padding": 7, "object_size": 3, "player_size": 5, "uuid": "16fa8542-d5ca-4189-a6f9-7effd8b3aa4d"}}, {"frame_data": {"ms_elapsed": 0, "objects": [{"cluster_id": 1, "mask_value": 3, "value": 1, "x": 4, "y": 6}, {"cluster_id": 1, "mask_value": 0, "value": 1, "x": 12, "y": 3}, {"cluster_id": 1, "mask_value": 1, "value": 1, "x": 16, "y": 11}, {"cluster_id": 1, "mask_value": 1, "value": -1, "x": 6, "y": 14}, {"cluster_id": 1, "mask_value": 0, "value": -1, "x": 13, "y": 18}, {"cluster_id": 2, "mask_value": 2, "value": 1, "x": 58, "y": 10}, {"cluster_id": 2, "mask_value": 3, "value": 1, "x": 66, "y": 10}, {"cluster_id": 2, "mask_value": 0, "value": -1, "x": 60, "y": 17}, {"cluster_id": 2, "mask_value": 2, "value": -1, "x": 65, "y": 3}, {"cluster_id": 2, "mask_value": 3, "value": -1, "x": 56, "y": 3}, {"cluster_id": 3, "mask_value": 3, "value": 1, "x": 63, "y": 57}, {"cluster_id": 3, "mask_value": 3, "value": 1, "x": 65, "y": 71}, {"cluster_id": 3, "mask_value": 1, "value": -1, "x": 57, "y": 66}, {"cluster_id": 3, "mask_value": 2, "value": -1, "x": 70, "y": 56}, {"cluster_id": 3, "mask_value": 3, "value": -1, "x": 69, "y": 64}, {"cluster_id": 4, "mask_value": 0, "value": 1, "x": 15, "y": 64}, {"cluster_id": 4, "mask_value": 3, "value": 1, "x": 12, "y": 71}, {"cluster_id": 4, "mask_value": 2, "value": 1, "x": 17, "y": 57}, {"cluster_id": 4, "mask_value": 2, "value": 1, "x": 5, "y": 61}, {"cluster_id": 4, "mask_value": 0, "value": -1, "x": 4, "y": 71}], "player": {"x": 38, "y": 38}, "score": 0}, "game_metadata": {"cluster_configs": [{"actual_negative_value": -2, "actual_positive_value": 3, "centroid": [11, 11], "id": 1, "num_objects": 5, "pos_objects": 3}, {"actual_negative_value": -3, "actual_positive_value": 2, "centroid": [64, 11], "id": 2, "num_objects": 5, "pos_objects": 2}, {"actual_negative_value": -3, "actual_positive_value": 2, "centroid": [64, 64], "id": 3, "num_objects": 5, "pos_objects": 2}, {"actual_negative_value": -1, "actual_positive_value": 4, "centroid": [11, 64], "id": 4, "num_objects": 5, "pos_objects": 4}], "cluster_width": 20, "grid_size": 75, "level_duration_seconds": 8, "level_number": 3, "max_cluster_value": 4, "name": "boolean_1.0", "object_padding": 7, "object_size": 3, "player_size": 5, "uuid": "ad10cd70-85ae-43fc-9ef5-dfc4d5546d2c"}}, {"frame_data": {"ms_elapsed": 0, "objects": [{"cluster_id": 1, "mask_value": 1, "value": 1, "x": 7, "y": 14}, {"cluster_id": 1, "mask_value": 1, "value": 1, "x": 4, "y": 3}, {"cluster_id": 1, "mask_value": 0, "value": 1, "x": 17, "y": 3}, {"cluster_id": 1, "mask_value": 3, "value": -1, "x": 18, "y": 17}, {"cluster_id": 1, "mask_value": 0, "value": -1, "x": 18, "y": 10}, {"cluster_id": 2, "mask_value": 1, "value": 1, "x": 64, "y": 15}, {"cluster_id": 2, "mask_value": 3, "value": 1, "x": 63, "y": 7}, {"cluster_id": 2, "mask_value": 3, "value": 1, "x": 56, "y": 9}, {"cluster_id": 2, "mask_value": 3, "value": 1, "x": 71, "y": 17}, {"cluster_id": 2, "mask_value": 0, "value": -1, "x": 57, "y": 16}, {"cluster_id": 3, "mask_value": 3, "value": 1, "x": 71, "y": 67}, {"cluster_id": 3, "mask_value": 3, "value": 1, "x": 63, "y": 59}, {"cluster_id": 3, "mask_value": 2, "value": -1, "x": 70, "y": 58}, {"cluster_id": 3, "mask_value": 0, "value": -1, "x": 59, "y": 68}, {"cluster_id": 3, "mask_value": 0, "value": -1, "x": 56, "y": 58}, {"cluster_id": 4, "mask_value": 3, "value": -1, "x": 8, "y": 70}, {"cluster_id": 4, "mask_value": 2, "value": -1, "x": 10, "y": 56}, {"cluster_id": 4, "mask_value": 3, "value": -1, "x": 3, "y": 56}, {"cluster_id": 4, "mask_value": 0, "value": -1, "x": 15, "y": 67}, {"cluster_id": 4, "mask_value": 0, "value": -1, "x": 17, "y": 60}], "player": {"x": 38, "y": 38}, "score": 0}, "game_metadata": {"cluster_configs": [{"actual_negative_value": -2, "actual_positive_value": 3, "centroid": [11, 11], "id": 1, "num_objects": 5, "pos_objects": 3}, {"actual_negative_value": -1, "actual_positive_value": 4, "centroid": [64, 11], "id": 2, "num_objects": 5, "pos_objects": 4}, {"actual_negative_value": -3, "actual_positive_value": 2, "centroid": [64, 64], "id": 3, "num_objects": 5, "pos_objects": 2}, {"actual_negative_value": -5, "actual_positive_value": 0, "centroid": [11, 64], "id": 4, "num_objects": 5, "pos_objects": 0}], "cluster_width": 20, "grid_size": 75, "level_duration_seconds": 8, "level_number": 4, "max_cluster_value": 4, "name": "boolean_1.0", "object_padding": 7, "object_size": 3, "player_size": 5, "uuid": "5cf7b32d-7b64-471b-a465-b4ff95e12729"}}, {"frame_data": {"ms_elapsed": 0, "objects": [{"cluster_id": 1, "mask_value": 2, "value": 1, "x": 17, "y": 10}, {"cluster_id": 1, "mask_value": 1, "value": 1, "x": 6, "y": 18}, {"cluster_id": 1, "mask_value": 1, "value": -1, "x": 6, "y": 8}, {"cluster_id": 1, "mask_value": 2, "value": -1, "x": 16, "y": 17}, {"cluster_id": 1, "mask_value": 3, "value": -1, "x": 16, "y": 3}, {"cluster_id": 2, "mask_value": 3, "value": 1, "x": 61, "y": 14}, {"cluster_id": 2, "mask_value": 2, "value": 1, "x": 63, "y": 5}, {"cluster_id": 2, "mask_value": 1, "value": 1, "x": 71, "y": 16}, {"cluster_id": 2, "mask_value": 3, "value": 1, "x": 56, "y": 4}, {"cluster_id": 2, "mask_value": 1, "value": 1, "x": 70, "y": 9}, {"cluster_id": 3, "mask_value": 3, "value": 1, "x": 61, "y": 67}, {"cluster_id": 3, "mask_value": 3, "value": 1, "x": 70, "y": 56}, {"cluster_id": 3, "mask_value": 3, "value": 1, "x": 70, "y": 70}, {"cluster_id": 3, "mask_value": 3, "value": -1, "x": 61, "y": 57}, {"cluster_id": 3, "mask_value": 3, "value": -1, "x": 68, "y": 63}, {"cluster_id": 4, "mask_value": 2, "value": -1, "x": 3, "y": 71}, {"cluster_id": 4, "mask_value": 2, "value": -1, "x": 16, "y": 61}, {"cluster_id": 4, "mask_value": 3, "value": -1, "x": 8, "y": 64}, {"cluster_id": 4, "mask_value": 2, "value": -1, "x": 12, "y": 71}, {"cluster_id": 4, "mask_value": 1, "value": -1, "x": 6, "y": 57}], "player": {"x": 38, "y": 38}, "score": 0}, "game_metadata": {"cluster_configs": [{"actual_negative_value": -3, "actual_positive_value": 2, "centroid": [11, 11], "id": 1, "num_objects": 5, "pos_objects": 2}, {"actual_negative_value": 0, "actual_positive_value": 5, "centroid": [64, 11], "id": 2, "num_objects": 5, "pos_objects": 5}, {"actual_negative_value": -2, "actual_positive_value": 3, "centroid": [64, 64], "id": 3, "num_objects": 5, "pos_objects": 3}, {"actual_negative_value": -5, "actual_positive_value": 0, "centroid": [11, 64], "id": 4, "num_objects": 5, "pos_objects": 0}], "cluster_width": 20, "grid_size": 75, "level_duration_seconds": 8, "level_number": 5, "max_cluster_value": 5, "name": "boolean_1.0", "object_padding": 7, "object_size": 3, "player_size": 5, "uuid": "33e3949a-99f3-4298-bf73-7a207df5f9ef"}}, {"frame_data": {"ms_elapsed": 0, "objects": [{"cluster_id": 1, "mask_value": 3, "value": 1, "x": 18, "y": 8}, {"cluster_id": 1, "mask_value": 3, "value": 1, "x": 8, "y": 12}, {"cluster_id": 1, "mask_value": 3, "value": -1, "x": 10, "y": 3}, {"cluster_id": 1, "mask_value": 1, "value": -1, "x": 3, "y": 3}, {"cluster_id": 1, "mask_value": 1, "value": -1, "x": 18, "y": 15}, {"cluster_id": 2, "mask_value": 2, "value": 1, "x": 60, "y": 13}, {"cluster_id": 2, "mask_value": 3, "value": -1, "x": 67, "y": 17}, {"cluster_id": 2, "mask_value": 3, "value": -1, "x": 58, "y": 5}, {"cluster_id": 2, "mask_value": 3, "value": -1, "x": 67, "y": 3}, {"cluster_id": 2, "mask_value": 3, "value": -1, "x": 69, "y": 10}, {"cluster_id": 3, "mask_value": 1, "value": 1, "x": 69, "y": 69}, {"cluster_id": 3, "mask_value": 2, "value": 1, "x": 56, "y": 63}, {"cluster_id": 3, "mask_value": 2, "value": 1, "x": 56, "y": 56}, {"cluster_id": 3, "mask_value": 3, "value": -1, "x": 61, "y": 70}, {"cluster_id": 3, "mask_value": 2, "value": -1, "x": 63, "y": 58}, {"cluster_id": 4, "mask_value": 2, "value": 1, "x": 3, "y": 64}, {"cluster_id": 4, "mask_value": 1, "value": 1, "x": 15, "y": 68}, {"cluster_id": 4, "mask_value": 1, "value": 1, "x": 10, "y": 56}, {"cluster_id": 4, "mask_value": 3, "value": -1, "x": 18, "y": 61}, {"cluster_id": 4, "mask_value": 0, "value": -1, "x": 6, "y": 71}], "player": {"x": 38, "y": 38}, "score": 0}, "game_metadata": {"cluster_configs": [{"actual_negative_value": -3, "actual_positive_value": 2, "centroid": [11, 11], "id": 1, "num_objects": 5, "pos_objects": 2}, {"actual_negative_value": -4, "actual_positive_value": 1, "centroid": [64, 11], "id": 2, "num_objects": 5, "pos_objects": 1}, {"actual_negative_value": -2, "actual_positive_value": 3, "centroid": [64, 64], "id": 3, "num_objects": 5, "pos_objects": 3}, {"actual_negative_value": -2, "actual_positive_value": 3, "centroid": [11, 64], "id": 4, "num_objects": 5, "pos_objects": 3}], "cluster_width": 20, "grid_size": 75, "level_duration_seconds": 8, "level_number": 6, "max_cluster_value": 3, "name": "boolean_1.0", "object_padding": 7, "object_size": 3, "player_size": 5, "uuid": "3c8d408f-9b7e-43e0-98ac-751952a57b34"}}, {"frame_data": {"ms_elapsed": 0, "objects": [{"cluster_id": 1, "mask_value": 1, "value": 1, "x": 16, "y": 10}, {"cluster_id": 1, "mask_value": 1, "value": 1, "x": 9, "y": 9}, {"cluster_id": 1, "mask_value": 3, "value": 1, "x": 11, "y": 18}, {"cluster_id": 1, "mask_value": 0, "value": -1, "x": 18, "y": 18}, {"cluster_id": 1, "mask_value": 2, "value": -1, "x": 3, "y": 16}, {"cluster_id": 2, "mask_value": 1, "value": 1, "x": 67, "y": 18}, {"cluster_id": 2, "mask_value": 1, "value": 1, "x": 60, "y": 4}, {"cluster_id": 2, "mask_value": 0, "value": -1, "x": 59, "y": 14}, {"cluster_id": 2, "mask_value": 3, "value": -1, "x": 67, "y": 3}, {"cluster_id": 2, "mask_value": 0, "value": -1, "x": 68, "y": 11}, {"cluster_id": 3, "mask_value": 3, "value": 1, "x": 57, "y": 69}, {"cluster_id": 3, "mask_value": 2, "value": 1, "x": 65, "y": 63}, {"cluster_id": 3, "mask_value": 1, "value": -1, "x": 69, "y": 56}, {"cluster_id": 3, "mask_value": 3, "value": -1, "x": 56, "y": 60}, {"cluster_id": 3, "mask_value": 3, "value": -1, "x": 68, "y": 71}, {"cluster_id": 4, "mask_value": 0, "value": 1, "x": 18, "y": 64}, {"cluster_id": 4, "mask_value": 2, "value": 1, "x": 8, "y": 60}, {"cluster_id": 4, "mask_value": 1, "value": 1, "x": 8, "y": 69}, {"cluster_id": 4, "mask_value": 1, "value": 1, "x": 17, "y": 71}, {"cluster_id": 4, "mask_value": 0, "value": -1, "x": 17, "y": 57}], "player": {"x": 38, "y": 38}, "score": 0}, "game_metadata": {"cluster_configs": [{"actual_negative_value": -2, "actual_positive_value": 3, "centroid": [11, 11], "id": 1, "num_objects": 5, "pos_objects": 3}, {"actual_negative_value": -3, "actual_positive_value": 2, "centroid": [64, 11], "id": 2, "num_objects": 5, "pos_objects": 2}, {"actual_negative_value": -3, "actual_positive_value": 2, "centroid": [64, 64], "id": 3, "num_objects": 5, "pos_objects": 2}, {"actual_negative_value": -1, "actual_positive_value": 4, "centroid": [11, 64], "id": 4, "num_objects": 5, "pos_objects": 4}], "cluster_width": 20, "grid_size": 75, "level_duration_seconds": 8, "level_number": 7, "max_cluster_value": 4, "name": "boolean_1.0", "object_padding": 7, "object_size": 3, "player_size": 5, "uuid": "0af19c54-1ec7-4669-9f8f-17600bf4a047"}}, {"frame_data": {"ms_elapsed": 0, "objects": [{"cluster_id": 1, "mask_value": 1, "value": 1, "x": 11, "y": 17}, {"cluster_id": 1, "mask_value": 2, "value": -1, "x": 10, "y": 8}, {"cluster_id": 1, "mask_value": 3, "value": -1, "x": 17, "y": 4}, {"cluster_id": 1, "mask_value": 1, "value": -1, "x": 18, "y": 17}, {"cluster_id": 1, "mask_value": 3, "value": -1, "x": 3, "y": 5}, {"cluster_id": 2, "mask_value": 0, "value": -1, "x": 65, "y": 16}, {"cluster_id": 2, "mask_value": 2, "value": -1, "x": 63, "y": 3}, {"cluster_id": 2, "mask_value": 0, "value": -1, "x": 56, "y": 12}, {"cluster_id": 2, "mask_value": 3, "value": -1, "x": 71, "y": 4}, {"cluster_id": 2, "mask_value": 1, "value": -1, "x": 56, "y": 5}, {"cluster_id": 3, "mask_value": 3, "value": 1, "x": 56, "y": 61}, {"cluster_id": 3, "mask_value": 0, "value": 1, "x": 57, "y": 69}, {"cluster_id": 3, "mask_value": 2, "value": 1, "x": 63, "y": 57}, {"cluster_id": 3, "mask_value": 1, "value": 1, "x": 71, "y": 56}, {"cluster_id": 3, "mask_value": 1, "value": -1, "x": 64, "y": 70}, {"cluster_id": 4, "mask_value": 1, "value": 1, "x": 12, "y": 60}, {"cluster_id": 4, "mask_value": 0, "value": 1, "x": 4, "y": 61}, {"cluster_id": 4, "mask_value": 0, "value": -1, "x": 10, "y": 71}, {"cluster_id": 4, "mask_value": 0, "value": -1, "x": 18, "y": 67}, {"cluster_id": 4, "mask_value": 2, "value": -1, "x": 3, "y": 70}], "player": {"x": 38, "y": 38}, "score": 0}, "game_metadata": {"cluster_configs": [{"actual_negative_value": -4, "actual_positive_value": 1, "centroid": [11, 11], "id": 1, "num_objects": 5, "pos_objects": 1}, {"actual_negative_value": -5, "actual_positive_value": 0, "centroid": [64, 11], "id": 2, "num_objects": 5, "pos_objects": 0}, {"actual_negative_value": -1, "actual_positive_value": 4, "centroid": [64, 64], "id": 3, "num_objects": 5, "pos_objects": 4}, {"actual_negative_value": -3, "actual_positive_value": 2, "centroid": [11, 64], "id": 4, "num_objects": 5, "pos_objects": 2}], "cluster_width": 20, "grid_size": 75, "level_duration_seconds": 8, "level_number": 8, "max_cluster_value": 4, "name": "boolean_1.0", "object_padding": 7, "object_size": 3, "player_size": 5, "uuid": "10887843-c0ae-49de-b4d8-d30542c1dc71"}}, {"frame_data": {"ms_elapsed": 0, "objects": [{"cluster_id": 1, "mask_value": 2, "value": 1, "x": 10, "y": 15}, {"cluster_id": 1, "mask_value": 0, "value": 1, "x": 17, "y": 17}, {"cluster_id": 1, "mask_value": 0, "value": 1, "x": 12, "y": 6}, {"cluster_id": 1, "mask_value": 3, "value": 1, "x": 3, "y": 16}, {"cluster_id": 1, "mask_value": 0, "value": 1, "x": 4, "y": 5}, {"cluster_id": 2, "mask_value": 2, "value": 1, "x": 62, "y": 8}, {"cluster_id": 2, "mask_value": 0, "value": 1, "x": 59, "y": 18}, {"cluster_id": 2, "mask_value": 3, "value": 1, "x": 71, "y": 10}, {"cluster_id": 2, "mask_value": 0, "value": -1, "x": 66, "y": 18}, {"cluster_id": 2, "mask_value": 1, "value": -1, "x": 71, "y": 3}, {"cluster_id": 3, "mask_value": 2, "value": 1, "x": 69, "y": 62}, {"cluster_id": 3, "mask_value": 0, "value": -1, "x": 57, "y": 71}, {"cluster_id": 3, "mask_value": 1, "value": -1, "x": 61, "y": 62}, {"cluster_id": 3, "mask_value": 2, "value": -1, "x": 71, "y": 71}, {"cluster_id": 3, "mask_value": 0, "value": -1, "x": 64, "y": 70}, {"cluster_id": 4, "mask_value": 1, "value": 1, "x": 10, "y": 61}, {"cluster_id": 4, "mask_value": 1, "value": -1, "x": 5, "y": 69}, {"cluster_id": 4, "mask_value": 2, "value": -1, "x": 3, "y": 58}, {"cluster_id": 4, "mask_value": 3, "value": -1, "x": 18, "y": 67}, {"cluster_id": 4, "mask_value": 2, "value": -1, "x": 18, "y": 58}], "player": {"x": 38, "y": 38}, "score": 0}, "game_metadata": {"cluster_configs": [{"actual_negative_value": 0, "actual_positive_value": 5, "centroid": [11, 11], "id": 1, "num_objects": 5, "pos_objects": 5}, {"actual_negative_value": -2, "actual_positive_value": 3, "centroid": [64, 11], "id": 2, "num_objects": 5, "pos_objects": 3}, {"actual_negative_value": -4, "actual_positive_value": 1, "centroid": [64, 64], "id": 3, "num_objects": 5, "pos_objects": 1}, {"actual_negative_value": -4, "actual_positive_value": 1, "centroid": [11, 64], "id": 4, "num_objects": 5, "pos_objects": 1}], "cluster_width": 20, "grid_size": 75, "level_duration_seconds": 8, "level_number": 9, "max_cluster_value": 5, "name": "boolean_1.0", "object_padding": 7, "object_size": 3, "player_size": 5, "uuid": "4e603207-75bb-4f7b-bebb-584715871617"}}, {"frame_data": {"ms_elapsed": 0, "objects": [{"cluster_id": 1, "mask_value": 1, "value": 1, "x": 14, "y": 4}, {"cluster_id": 1, "mask_value": 3, "value": 1, "x": 11, "y": 18}, {"cluster_id": 1, "mask_value": 1, "value": 1, "x": 7, "y": 7}, {"cluster_id": 1, "mask_value": 3, "value": 1, "x": 17, "y": 11}, {"cluster_id": 1, "mask_value": 3, "value": -1, "x": 18, "y": 18}, {"cluster_id": 2, "mask_value": 3, "value": 1, "x": 71, "y": 6}, {"cluster_id": 2, "mask_value": 1, "value": 1, "x": 63, "y": 15}, {"cluster_id": 2, "mask_value": 1, "value": 1, "x": 63, "y": 6}, {"cluster_id": 2, "mask_value": 1, "value": 1, "x": 71, "y": 15}, {"cluster_id": 2, "mask_value": 3, "value": 1, "x": 56, "y": 9}, {"cluster_id": 3, "mask_value": 1, "value": -1, "x": 67, "y": 56}, {"cluster_id": 3, "mask_value": 0, "value": -1, "x": 58, "y": 68}, {"cluster_id": 3, "mask_value": 2, "value": -1, "x": 71, "y": 64}, {"cluster_id": 3, "mask_value": 0, "value": -1, "x": 60, "y": 58}, {"cluster_id": 3, "mask_value": 3, "value": -1, "x": 71, "y": 71}, {"cluster_id": 4, "mask_value": 2, "value": 1, "x": 10, "y": 71}, {"cluster_id": 4, "mask_value": 2, "value": -1, "x": 18, "y": 58}, {"cluster_id": 4, "mask_value": 3, "value": -1, "x": 11, "y": 59}, {"cluster_id": 4, "mask_value": 2, "value": -1, "x": 3, "y": 69}, {"cluster_id": 4, "mask_value": 1, "value": -1, "x": 17, "y": 70}], "player": {"x": 38, "y": 38}, "score": 0}, "game_metadata": {"cluster_configs": [{"actual_negative_value": -1, "actual_positive_value": 4, "centroid": [11, 11], "id": 1, "num_objects": 5, "pos_objects": 4}, {"actual_negative_value": 0, "actual_positive_value": 5, "centroid": [64, 11], "id": 2, "num_objects": 5, "pos_objects": 5}, {"actual_negative_value": -5, "actual_positive_value": 0, "centroid": [64, 64], "id": 3, "num_objects": 5, "pos_objects": 0}, {"actual_negative_value": -4, "actual_positive_value": 1, "centroid": [11, 64], "id": 4, "num_objects": 5, "pos_objects": 1}], "cluster_width": 20, "grid_size": 75, "level_duration_seconds": 8, "level_number": 10, "max_cluster_value": 5, "name": "boolean_1.0", "object_padding": 7, "object_size": 3, "player_size": 5, "uuid": "01c481a5-895e-4148-afd4-2c8512ae9c54"}}];

// Create a PageBlock page from a configuration
function buildSoloGameplayPage(taskConfig, valueMask, taskNumber, taskListLength, gameMode="normal"){

	return {
		'pagename': 'pageblock-dual-game-chat.html',
		'pagefunc': function() {

			updateScoreBox();

			$("#next").prop('disabled', true);
			$("#pageblock").css("text-align", "center");

			valueMask = (typeof valueMask !== 'undefined') ?  valueMask : partnerPairCondition;

			new gameExperiment(taskConfig, valueMask, 2,
				gameMode,
				"player",
				taskNumber, taskListLength,
				"left-game-window", 				// Use left side of frame
				gameMessageQueue, 					// No game frame queue
				() => {}, 							// No timestep callback needed
				(fullGameRecord) => {
					updateScoreBox(fullGameRecord);
					psiTurk.recordTrialData(fullGameRecord);
					psiTurk.saveData();
					$("#instructions-bottom").html(`<strong>Click \"Continue\" to advance.</strong>`);
					$("#next").prop('disabled', false);
				}
			);
		}
	}
}

function setPageBlockPostGameLoading(delaySeconds){

	$('#multiplayer-next').prop('disabled', true);

	$("#multiplayer-nav-text").html(
		`<p><strong>Setting up the next level<span id="ellipses">...</span></strong></p>`
	);

	let ellipses = setInterval(function () {
		var e = $("#ellipses").text();
		$("#ellipses").text(".".repeat((e.length+1) % 10));
	}, 500);

	setTimeout(() => {
		clearInterval(ellipses);
		$('#next').click();
	}, delaySeconds * 1000);

}

function buildMultiplayerGameplayPage(taskConfig, valueMask, taskNumber, taskListLength, gameMode="normal"){

	return {
		'pagename': 'pageblock-dual-game-chat.html',
		'pagefunc': function() {

			// Game State housekeeping: wipe queues, display score, etc.
			updateScoreBox();
			gameMessageQueue.length = 0;
			currentLevelNumber = taskNumber;
			$(".instructionsnav").hide();

			valueMask = (typeof valueMask !== 'undefined') ?  valueMask : partnerPairCondition;

			// Build Teacher UI //
			if (clientIsTeacher) {

				if (partnerPairCondition["communication"] === "demo") {

					// Make it clear it's the partner's turn to play
					$("#pageblock-dual-title").html(`<h2>Your partner's turn</h2>`);

				} else if (partnerPairCondition["communication"] === "chat") {

					// Chat teachers are responsible for advancing screen, so show button now
					$('#multiplayer-nav').show();
					$('#multiplayer-next').prop('disabled', true);

					$("#instructions-bottom").html(`Chat disabled`);
					$("#chat-ui").show();
					$("#chat-box").hide();
					$("#chat-send").hide();

				}

				// Give the teacher a view of the learner which *only* shows point values (no shapes / colors)
				new gameExperiment(taskConfig, graySquareValueMask, 1,
					gameMode,
					"observer",
					taskNumber,
					taskListLength,
					"left-game-window",
					gameMessageQueue,
					(data) => {},
					() => {}
				);

				// If they're full-viz, they see the learner's view as well
				if (partnerPairCondition["visibility"] === "full") {
					new gameExperiment(taskConfig, valueMask, 1,
						gameMode,
						"full_viz_observer",
						taskNumber,
						taskListLength,
						"right-game-window",
						gameMessageQueue,
						(data) => {
						},
						() => {
						}
					);
				} else {
					$('#right-game-window').html(`<img style="vertical-align:bottom" src="/static/images/partial_viz_question_marks.png" alt="The Game" />`);
				}

			// Build Player UI //

			} else {

				if (partnerPairCondition["communication"] === "demo") {

					// Make it clear that it's the player's turn
					$("#pageblock-dual-title").html(`<h2>Your turn!</h2>`);

					// If this is a demo round, player will need to advance screens
					// Chekov's Gun says we should show the (disabled) button now...
					$("#multiplayer-nav").show();
					$('#multiplayer-next').prop('disabled', true);
					multiplayerAdvanceDelaySeconds = 4; // And we can move quickly here.

				} else {

					// Similarly, show chat UI to player even though it's not yet active
					$("#instructions-bottom").html(`Chat disabled`);
					$("#chat-ui").show();
					$("#chat-box").hide();
					$("#chat-send").hide();

				}

				new gameExperiment(taskConfig, valueMask, 1,
					gameMode,
					"player",
					taskNumber,
					taskListLength,
					"left-game-window",
					gameMessageQueue,
					(data) => {gameserverio.send_message(JSON.stringify(data))},
					(fullGameRecord) => {

						// On player round end, update their score + bonus
						updateScoreBox(fullGameRecord);

						// Player is responsible for saving data
						psiTurk.recordTrialData(fullGameRecord);
						psiTurk.saveData();

						// We also send the data to our partner so they can log it for bonus-calc purposes
						gameserverio.send_message(JSON.stringify(fullGameRecord));

						// and shut down their Phaser instance(s)
						gameserverio.send_message(JSON.stringify({"name": "game_event", "event": "level_end", "level_number": currentLevelNumber}));

						if (partnerPairCondition["communication"] === "chat") {
							// If we're in a chat condition, then we want to send the teacher a message to enable chat
							// This holds both players in post-game while teacher can send messages
							gameserverio.send_message(JSON.stringify({"name": "enable_chat"}));
							$("#instructions-bottom").html(`<strong>Messages from Teacher</strong>`);

						} else if (partnerPairCondition["communication"] === "demo") {
							// If they're in a demo condition, let them hit next
							$("#instructions-bottom").html(`<strong>Click \"Continue\" to advance.</strong>`);
							$('#multiplayer-next').prop('disabled', false);
						}
					}
				);


			}
		}
	}

}

function buildDemonstrationGameplayPage(taskConfig, valueMask, taskNumber, taskListLength, gameMode="demonstration"){

	return {
		'pagename': 'pageblock-dual-game-chat.html',
		'pagefunc': function() {

			// If they're in a chat condition, we skip this page
			if (partnerPairCondition["communication"] === "chat") {
				$("#score-box").hide();
				$(".instructionsnav").hide();
				setTimeout(() => {
					$("#next").click()
				}, 100);
				return;
			}

			// Game State housekeeping: wipe queues, display score, etc.
			updateScoreBox();
			gameMessageQueue.length = 0;
			currentLevelNumber = taskNumber;
			$(".instructionsnav").hide();

			valueMask = (typeof valueMask !== 'undefined') ?  valueMask : partnerPairCondition;

			// Build Teacher UI //
			if (clientIsTeacher) {

				// Teacher gets advancing controls here
				$('#multiplayer-next').prop('disabled', true);
				$("#multiplayer-nav").show();
				multiplayerAdvanceDelaySeconds = 4;

				$("#pageblock-dual-title").html(`<h2>Your turn</h2>`);
				$("#instructions-bottom").html(`<strong>Your partner is watching!</strong>`);

				// Left side plays; pushes data to right side and up to server
				new gameExperiment(taskConfig, graySquareValueMask, 5,
					gameMode,
					"player",
					taskNumber,
					taskListLength,
					"left-game-window",
					[],
					(frameData) => {
						gameserverio.send_message(JSON.stringify(frameData));
						gameMessageQueue.push(frameData);
					},
					(fullGameRecord) => {

						// Log demonstration round
						psiTurk.recordTrialData(fullGameRecord);

						// Tell the right-side game to stop
						gameMessageQueue.push({"name": "game_event", "event": "level_end", "level_number": currentLevelNumber});

						// Enable our advance-partner button
						$("#instructions-bottom").html(`<strong>Click \"Continue\" to advance.</strong>`);
						$('#multiplayer-next').prop('disabled', false);

					}
				);

				if (partnerPairCondition["visibility"] === "full") {
					new gameExperiment(taskConfig, valueMask, 5,
						gameMode,
						"full_viz_observer",
						taskNumber,
						taskListLength,
						"right-game-window",
						gameMessageQueue,
						() => {}, // Don't need callbacks
						() => {}
					);
				}
				else {
					$('#right-game-window').html(`<img style="vertical-align:bottom" src="/static/images/partial_viz_question_marks.png" alt="The Game" />`);
				}

			// Build Player UI //
			} else {

				$("#pageblock-dual-title").html(`<h2>Partner's turn</h2>`);

				new gameExperiment(taskConfig, valueMask, 5,
					"demonstration",
					"observer",
					taskNumber,
					taskListLength,
					"left-game-window",
					gameMessageQueue,
					(data) => {},
					() => {}
				);

			}
		}
	}

}

function updateScoreBox(fullGameRecord) {

	// If we got a new game record, update score / bonus
	if (typeof fullGameRecord !== "undefined" &&  fullGameRecord["mode"] === "normal") {
		currentScore += fullGameRecord["score"];
		let rawBonus = currentScore / totalPossiblePoints * totalPossibleBonusCents;
		currentBonusCents = Math.floor(Math.max(rawBonus, 0));
	}

	// Regardless, update HTML content in box and display it
	$('#score-box').show();
	$("#score-box").css("text-align", "center");

	$('#current-score').html(currentScore);
	let bonusDisplayString = (currentBonusCents / 100).toFixed(2);

	$('#current-bonus').html(bonusDisplayString);
}

function setSinglePlayerConfig() {

	// We won't get a human partner, so use local configuration
	partnerPairCondition = initialPartnerPairCondition;

	// If they have ``full'' visibility, then add the gray square object configuration in.
	// This will override display functionality on single player levels so they see actual object values.
	if (partnerPairCondition["visibility"] === "full") {
		partnerPairCondition = Object.assign({}, partnerPairCondition, graySquareValueMask);
	}

	// Log to Psiturk
	let payload = partnerPairCondition;
	payload["learner_uuid"] = uniqueId;
	payload["pair_uuid"] = "";
	payload["name"] = "pairing_configuration";
	psiTurk.recordTrialData(payload);
	psiTurk.saveData();
}

/*******************
 * INSTRUCTIONS
 ******************/

let captchaPages = [
	{
		pagename: 'captcha.html',
		pagefunc: () => {
			$("#next").prop('disabled', true);
		}
	}];

let basicInstructionsPages = [

	{
		pagename: 'pageblock.html',
		pagefunc: () => {
			let survey = new PageBlockSurveyHandler({containername: "pageblock"});
			survey.addone({
				type: 'textdisplay',
				name: 'instructions-1',
				questiontext:  `
					<div>
						<h3>Robot Adventures</h3>
						
						<p>
						
						<strong>Gameplay</strong><br />
							Use the arrow keys to move around and collect objects.<br />
							You can press two simultaneously to move diagonally.<br /><br />
						
							You'll have 8 seconds on each level to collect objects.
						</p>
						
						<img id="example_game" class="center-image" width="40%" src="/static/images/first_instructions_page_boolean.png" alt="The Game" />
						<img id="arrow_keys" class="center-image" width="20%" src="/static/images/arrow_keys.png" alt="The Controls" />
						
						<br /><br />
						<h3>Scoring</h3>
				
						<p>
						<strong>Objects can be negative!</strong> <br />
						Collect positive objects and avoid negative ones. <br /><br />
						
						<strong>Bonus</strong> <br />
						You'll play a few practice rounds, then 10 actual games. <br />
						Your bonus will be based on your cumulative score over the 10 games.<br /> <br />
						</p>
						
						<p align="center">
							<strong>Click to play a practice round.</strong>
						</p>
					</div>`,
			});
		}
	},

	buildSoloGameplayPage(practiceRounds[1], graySquareValueMask, 0, 1, "practice"),

];

let colorMaskInstructions = [
	{
		pagename: 'pageblock-dual-game-chat.html',
		pagefunc: function () {

		$('#multiplayer-nav').hide();

		$("#pageblock-dual-title").html(
			`
			<h3>Shapes and Colors</h3>
			
			<p>
			In the real game, you'll collect objects with different shapes and colors.<br /> <br />
			<strong>Shape and color determines value:</strong> some shapes and colors are positive, and others are negative.</strong><br />
			<strong>Locations are random:</strong> objects are distributed randomly to each corner on each level. <br /><br />
			</p>
	
			<img id="example_game" width="80%" src="/static/images/cluster_with_mask_boolean.png" alt="The Game" />
			<br /><br />
			`
		);

		if (initialPartnerPairCondition["communication"] === "singleplayer") {

			$("#instructions-bottom").html(`
				<h3>What Are Objects Worth?</h3>
				At the end of each level, you'll see your score for that level. <br />
				You can use that to figure out which objects are positive. <br /> <br />
			`);

		}
	}},

	buildSoloGameplayPage(practiceRounds[2], {},  0, 1, "practice"),

];

let pageBlockChatPairingPage = {
	'pagename': 'pageblock.html',
	'pagefunc': () => {

		reliantOnPartner = true;

		$(".instructionsnav").hide();

		$("#pageblock").html(
			`<h2>Waiting Room</h2>
			<div id="finding_partner">
				<p>Great! Now we will pair you with a partner.</p><br />
				
				<strong>Pairing usually takes 15-30 seconds.<br /></strong>
				If we cannot find a partner after 2 minutes, you will be redirected to the end of the HIT and receive payment.<br /><br />
				
				<p><strong>You must keep this window in the foreground for timer to count down.</strong><br />
				Looking for a partner<span id="ellipses">...</span></p>
				
			</div>`
		);

		let ellipses = setInterval(function () {
			var e = $("#ellipses").text();
			$("#ellipses").text(".".repeat((e.length+1) % 10));
		}, 500)

		let no_partner = setTimeout((function () {
			return () => {
				psiTurk.recordUnstructuredData('partner_found', false);
				clearInterval(ellipses);
				psiTurk.saveData({
					success: () =>  {
						$("#finding_partner").text(
							"We were unable to find you a partner. " +
							"You will be redirected to the end of the HIT and receive payment."
						);
						console.log("Data sent");
						setTimeout(function () {
							finish();
						}, 5000);
					}
				});

			}
		})(), 120000);

		gameserverio.request_partners({
			callback: (function () {
				return (data) => {

					// Clear out ellipses UI and timeout thing
					clearInterval(ellipses);
					clearTimeout(no_partner);
					gameserver_partner_id = gameserverio.roomdata['partners'][0];
					gameserver_client_id = gameserverio.roomdata['client_id'];

					if (data["client_number"] === 0) {
						$("#finding_partner").html("You are the <strong>teacher</strong>!<br /><br />");

						// The teacher's condition will determine the pair's experience
						clientIsTeacher = true;
						partnerPairCondition = ConditionEnum[condition];

						// Send this message over to the player so they can log the full experiment conditions
						gameserverio.send_message(JSON.stringify({
							"name": "experiment_condition",
							"teacher_uuid": uniqueId,
							"teacher_condition_number": condition,
							"condition": partnerPairCondition
						}))

					} else if (data["client_number"] === 1) {

						$("#finding_partner").html("You are the <strong>learner</strong>!");
						clientIsTeacher = false;

					}

					setTimeout(() => {
						$("#next").click()
					}, 5000);

				}
			})()
		});
	}
};

let pairedInstruction = [

	buildConditionDependentPairedInstructionsPage(),

	buildMultiplayerGameplayPage(practiceRounds[3], undefined, 0, 1, "practice"),

	buildDemonstrationGameplayPage(practiceRounds[3], undefined, 0, 1, "practice"),

];

function buildConditionDependentPairedInstructionsPage() {

	return {
		'pagename': 'pageblock-dual-game-chat.html',
		'pagefunc': function () {

			// No nav-- we auto-advance through this page
			$(".instructionsnav").hide();
			$('#multiplayer-nav').hide();

			$("#instructions-top").css("text-align", "left");
			$("#pageblock-dual-title").css("text-align", "left");
			$("#pageblock-dual-title").css("text-align", "left");

			let ellipses = setInterval(function () {
				var e = $("#ellipses").text();
				$("#ellipses").text(".".repeat((e.length + 1) % 10));
			}, 1000);

			// If they're the teacher...
			if (clientIsTeacher) {

                $('#multiplayer-nav').show();

				$("#pageblock-dual-title").html(
					`<h2>You are the Teacher</h2>
					Your job is to teach the player which shapes are positive. <br /><br />
					<h2>Bonus</h2>
					Your partner's score will determine both of your bonuses!
					Pairs that work together earn more, so please be respectful and try your best. <br />
					If you have any issues, email us and we will make sure you are compensated for your time.
						`
				);

                if (partnerPairCondition["communication"] === "chat") {

                    $("#instructions-top").html(
                        `
							<h2>Teaching your Partner</h2>

							<p>After each round, you can send your partner messages.
							They'll see your messages, but can't respond.<br /><br /> </p>
							<img id="example_game" width="80%" class="center-image" src="/static/images/instructions_chat_ui_teacher.png" alt="The Game" border="10"/>
						`
                    );

                }
                else if (partnerPairCondition["communication"] === "demo") {

                    $("#instructions-top").html(
                        `	
							<h2>Teaching your Partner</h2>
							<div>
								<p>After each round, you'll play the same level your partner played.<br />
								Your partner will watch you play and see your score. Your score won't count-- use this opportunity to teach your partner. <br /> <br />
							</div>
						`
                    );

                }

				if (partnerPairCondition["visibility"] === "full") {

					$("#left-game-window").html(
						`
							<h2>What Your Partner Sees</h2><br />
							<img id="example_game" class="center-image" src="/static/images/teacher_boolean_partner_view_inverted.png" alt="The Game" />
                            <h2>What You'll See</h2><br />
							<img id="example_game" class="center-image" src="/static/images/teacher_boolean_full_viz_inverted.png" alt="The Game" />
						`
					);

				}
				else if (partnerPairCondition["visibility"] === "partial") {

					$("#left-game-window").html(
						`
							<h2>What Your Partner Sees</h2><br />
							<img id="example_game" class="center-image" src="/static/images/teacher_boolean_partner_view.png" alt="The Game" />
                            <h2>What You'll See</h2><br />
							<img id="example_game" class="center-image" src="/static/images/teacher_boolean_partial_viz_inverted.png" alt="The Game" />
						`
					);

				}

            }

			else {

				$("#pageblock-dual-title").html(
					`
							<h2>You are the Learner</h2>
							<div>
							Your job is to collect positive shapes. The teacher will help you figure out which are positive. <br />
							</div>
							<h2>Bonus</h2>
							Your score will determine both your bonus and your partner's bonus!
							Pairs that work together earn more, so please be listen to the teacher and try your best.<br /> 
							If you have any issues, email us and we will make sure you are compensated for your time.
						`
				);

				if (partnerPairCondition["communication"] === "chat") {

					$("#instructions-top").html(
						`
							<h2>Teacher Messages</h2>
							<div>
								<p>After each round, your partner will give you advice via a chat UI (below).<br />
								You'll see their messages, but you won't be able to respond. <br /> <br />
								
								<img id="teacher_chat_ui" width="80%" class="center-image" src="/static/images/instructions_chat_ui_learner.png" border="10" alt="The Game" />

							</div>
						`
					);

				}
				else if (partnerPairCondition["communication"] === "demo") {

					$("#instructions-top").html(
						`							
							<h2>Teacher Demonstrations</h2>
							<div>
								<p>After each round, your partner will play the same level you just played.<br />
								Their score won't count, but you'll be able to watch and learn. <br /> <br />
							</div>
						`
					);

				}


				$("#instructions-bottom").html(
					`<p><strong>Waiting for teacher to advance...<span id="ellipses">...</span></strong></p>`
				);

			}

		}
	}
}


let finalInstructions = [
	{
		pagename: 'pageblock.html',
		pagefunc: () => {
			let survey = new PageBlockSurveyHandler({containername: "pageblock"});
			survey.addone({
				type: 'textdisplay',
				name: 'instructions-practice-mask',
				questiontext:
					`
				<div>
					<h3>Ready to Go!</h3>
										
					<p align="center"> <br /> <br />
						<strong>You'll see the same set of colors / shapes for all 10 rounds.</strong><br />
						Loading levels now-- good luck!
					</p>	
				</div>
				`,
			});

			if(clientIsTeacher && partnerPairCondition["visibility"] === "full"){
				survey.addone({
					type: 'textdisplay',
					name: 'instructions-practice-mask',
					questiontext:
						`Remember, <strong> your partner cannot see this display</strong>: \n<img src="/static/images/white_top_border_concept_display.png"/>`,
				});
			}

			$(".instructionsnav").hide();

			setTimeout(() => {
				$("#next").click()
			}, 8000)

		}
	}];


/*******************
 * SURVEY
 ******************/

let conceptSurveyQuestions = [
	{
	type: 'textdisplay',
	questiontext: `<h3>What was each object worth?</h3>`
	}, {
		type: 'horizontal-radio',
		name: 'blue_square_hollow',
		questiontext: `<img src="/static/images/objects/blue_square_hollow.png"/>`,
		options: [
			{value: '-1', optiontext: '-1'},
			{value: '0', optiontext: 'Don\'t Know'},
			{value: '1', optiontext: '+1'},
		],
		required: true
	},
	{
		type: 'horizontal-radio',
		name: 'blue_square_solid',
		questiontext: `<img src="/static/images/objects/blue_square_solid.png"/>`,
		options: [
			{value: '-1', optiontext: '-1'},
			{value: '0', optiontext: 'Don\'t Know'},
			{value: '1', optiontext: '+1'},
		],
		required: true
	},
	{
		type: 'horizontal-radio',
		name: 'pink_square_hollow',
		questiontext: `<img src="/static/images/objects/pink_square_hollow.png"/>`,
		options: [
			{value: '-1', optiontext: '-1'},
			{value: '0', optiontext: 'Don\'t Know'},
			{value: '1', optiontext: '+1'},
		],
		required: true
	},
	{
		type: 'horizontal-radio',
		name: 'pink_square_solid',
		questiontext: `<img src="/static/images/objects/pink_square_solid.png"/>`,
		options: [
			{value: '-1', optiontext: '-1'},
			{value: '0', optiontext: 'Don\'t Know'},
			{value: '1', optiontext: '+1'},
		],
		required: true
	},
	{
		type: 'horizontal-radio',
		name: 'pink_triangle_solid',
		questiontext: `<img src="/static/images/objects/pink_triangle_solid.png"/>`,
		options: [
			{value: '-1', optiontext: '-1'},
			{value: '0', optiontext: 'Don\'t Know'},
			{value: '1', optiontext: '+1'},
		],
		required: true
	},
	{
		type: 'horizontal-radio',
		name: 'pink_triangle_hollow',
		questiontext: `<img src="/static/images/objects/pink_triangle_hollow.png"/>`,
		options: [
			{value: '-1', optiontext: '-1'},
			{value: '0', optiontext: 'Don\'t Know'},
			{value: '1', optiontext: '+1'},
		],
		required: true
	},
	{
		type: 'horizontal-radio',
		name: 'blue_triangle_solid',
		questiontext: `<img src="/static/images/objects/blue_triangle_solid.png"/>`,
		options: [
			{value: '-1', optiontext: '-1'},
			{value: '0', optiontext: 'Don\'t Know'},
			{value: '1', optiontext: '+1'},
		],
		required: true
	},
	{
		type: 'horizontal-radio',
		name: 'blue_triangle_hollow',
		questiontext: `<img src="/static/images/objects/blue_triangle_hollow.png"/>`,
		options: [
			{value: '-1', optiontext: '-1'},
			{value: '0', optiontext: 'Don\'t Know'},
			{value: '1', optiontext: '+1'},
		],
		required: true
	},
	];

let basicGameplaySurveyQuestions = [
	{
		type: 'textdisplay',
		questiontext: `<h3>Survey</h3>`
	},
	{
		type: 'horizontal-radio',
		name: 'difficulty',
		questiontext: 'How difficult was this game?',
		options: [
			{value: '1', optiontext: 'Very Difficult'},
			{value: '2', optiontext: 'Difficult'},
			{value: '3', optiontext: 'Somewhat Difficult'},
			{value: '4', optiontext: 'Somewhat Easy'},
			{value: '5', optiontext: 'Easy'},
			{value: '6', optiontext: 'Very Easy'}
		],
		required: true
	},
	{
		type: 'horizontal-radio',
		name: 'fun',
		questiontext: 'How fun was this game?',
		options: [
			{value: '1', optiontext: 'Very Unfun'},
			{value: '2', optiontext: 'Unfun'},
			{value: '3', optiontext: 'Somewhat Unfun'},
			{value: '4', optiontext: 'Somewhat Fun'},
			{value: '5', optiontext: 'Fun'},
			{value: '6', optiontext: 'Very Fun'}
		],
		required: true
	},
	{
		type: 'horizontal-radio',
		name: 'gameplay-lag',
		questiontext: 'Did you experience lag or jumpiness?',
		options: [
			{value: '1', optiontext: 'Very laggy'},
			{value: '2', optiontext: 'A little laggy'},
			{value: '3', optiontext: 'Pretty good'},
			{value: '4', optiontext: 'All good'},
		],
		required: true
	}
];

let pageBlockSurveyPages = [
	{
		pagename: 'pageblock.html',
		pagefunc: () => {

			reliantOnPartner = false;

			let survey = new PageBlockSurveyHandler({containername: "pageblock"});

			let full_viz_teacher = clientIsTeacher && partnerPairCondition["visibility"] === 'full';
			let multiplayer_learner = !clientIsTeacher && partnerPairCondition["communication"] !== "singleplayer";
			let solo_learner = partnerPairCondition["communication"] === "singleplayer" && partnerPairCondition["visibility"] === 'partial';

			if (full_viz_teacher || multiplayer_learner || solo_learner) {
				survey.add(conceptSurveyQuestions);
			}
			survey.add(basicGameplaySurveyQuestions);

			if (partnerPairCondition["communication"] !== "singleplayer") {

				survey.add([
					{
						type: 'horizontal-radio',
						name: 'cooperative',
						questiontext: 'How cooperative was your partner?',
						options: [
							{value: '1', optiontext: 'Very Uncooperative'},
							{value: '2', optiontext: 'Uncooperative'},
							{value: '3', optiontext: 'Somewhat Uncooperative'},
							{value: '4', optiontext: 'Somewhat Cooperative'},
							{value: '5', optiontext: 'Cooperative'},
							{value: '6', optiontext: 'Very Cooperative'}
						],
						required: true
					},
					{
						type: 'horizontal-radio',
						name: 'helpfulness',
						questiontext: 'How helpful was your partner?',
						options: [
							{value: '1', optiontext: 'Very Unhelpful'},
							{value: '2', optiontext: 'Unhelpful'},
							{value: '3', optiontext: 'Somewhat Unhelpful'},
							{value: '4', optiontext: 'Somewhat Helpful'},
							{value: '5', optiontext: 'Helpful'},
							{value: '6', optiontext: 'Very Helpful'}
						],
						required: true
					}]
				);
			}

			if (clientIsTeacher) {

				survey.add([
					{
						type: 'horizontal-radio',
						name: 'teacher-try-hard',
						questiontext: 'Did you actually try to teach the learner?\n(please be honest-- this is just for data analysis)',
						options: [
							{value: '1', optiontext: 'Not really'},
							{value: '2', optiontext: 'I tried a little'},
							{value: '3', optiontext: 'I tried a lot'},
							{value: '4', optiontext: 'I tried as hard as I could'}
						],
						required: true
					},
					{
						type: 'horizontal-radio',
						name: 'teacher-helpful',
						questiontext: 'How helpful do you think you were?',
						options: [
							{value: '1', optiontext: 'Very Unhelpful'},
							{value: '2', optiontext: 'Unhelpful'},
							{value: '3', optiontext: 'Somewhat Unhelpful'},
							{value: '4', optiontext: 'Somewhat Helpful'},
							{value: '5', optiontext: 'Helpful'},
							{value: '6', optiontext: 'Very Helpful'}
						],
						required: true
					}]);

			}

			survey.add([{
				type: 'textbox',
				name: 'comments',
				questiontext: 'Any final thoughts / comments?',
				leftalign: false,
				required: false
			}])

		}
	}];

/*******************
 * Callback to allow PsiTurk to take back over for end of experiment
 ******************/

var finish = function() {

	psiTurk.saveData();
	psiTurk.computeBonus('compute_bonus', function() {

		// PROLIFIC vs MTURK
		if (new URLSearchParams(location.search).get('hitId') === 'prolific') {
            $(window).off("beforeunload");
            $('#container-instructions').hide();
            $('#prolific-completion-code').html(`Thank you for participating! <br>
        			Your completion code is <b>11C67846</b>
        			Click this link to submit<br>
       	 			<a href=https://app.prolific.co/submissions/complete?cc=11C67846>
        				https://app.prolific.co/submissions/complete?cc=11C67846</a>`);
            $('#prolific-complete').show();
		} else {
			psiTurk.completeHIT(); // when finished saving compute bonus, then quit
		}

	});

};


/*******************
 * Run Task
 ******************/
$(window).load( function() {

	// To overwrite condition for testing purposes
	// overwritten_condition = 12; // 0: chat-full, 6: demo-full; 12: chat-partial; 18: demo-partial
	// initialPartnerPairCondition = ConditionEnum[overwritten_condition];

	// Start with instructions / practice rounds
	let pageBlockPages = [];

	// Initial captcha / instructions
	pageBlockPages = pageBlockPages.concat(captchaPages);
	// pageBlockPages = [];

	pageBlockPages = pageBlockPages.concat(basicInstructionsPages);

	// If they're in a masked condition, give them additional instructions + a practice round
	let singlePlayerFullViz = (initialPartnerPairCondition["communication"] === "singleplayer" &&
								initialPartnerPairCondition["visibility"] === "full");

	if (!singlePlayerFullViz) {
		pageBlockPages = pageBlockPages.concat(colorMaskInstructions);
	}

	// pageBlockPages = [];

	if (initialPartnerPairCondition["communication"] === "singleplayer") {
		setSinglePlayerConfig();
	}  else {
		pageBlockPages = pageBlockPages.concat(pageBlockChatPairingPage);
		pageBlockPages = pageBlockPages.concat(pairedInstruction);
	}

	pageBlockPages = pageBlockPages.concat(finalInstructions);

	// pageBlockPages = [];

	// Tack on gameplay rounds
	// for (let i = 0; i < 3; i++) {
	for (let i = 0; i < gameplayRounds.length; i++) {

		totalPossiblePoints += gameplayRounds[i]["game_metadata"]["max_cluster_value"];

		if (initialPartnerPairCondition["communication"] === "singleplayer") {

			pageBlockPages.push(buildSoloGameplayPage(
				gameplayRounds[i],
				partnerPairCondition,
				i + 1,
				gameplayRounds.length
			));

		} else {

			pageBlockPages.push(buildMultiplayerGameplayPage(
				gameplayRounds[i],
				partnerPairCondition,
				i + 1,
				gameplayRounds.length
				)
			);

			pageBlockPages.push(buildDemonstrationGameplayPage(
				gameplayRounds[i],
				partnerPairCondition,
				i + 1,
				gameplayRounds.length
				)
			);
		}
	}

	// To test just the survey
	// setSinglePlayerConfig();
	// pageBlockPages = [];

	pageBlockPages = pageBlockPages.concat(pageBlockSurveyPages);

	// Run PageBlock controller and have it call our main experiment function when done
	var pageBlockExperimentController = new PageBlockController(
		psiTurk, //parent
		pageBlockPages, //pages
		finish, //callback
		undefined, //closeAlert
		true //manual_saveData
	);

	pageBlockExperimentController.loadPage();

});
