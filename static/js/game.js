var gameExperiment = function(taskConfig, valueMaskConfig, postgamePauseDurationSeconds, gameMode, gameRole, levelNumber, totalNumberOfLevels, parentContainer,
                              gameFrameQueue, timestepCallback, gameplayEndCallback) {

    // The gameplaying surface will be a square of gameWidth x gameCanvasSize pixels.
    // Layout requires it be a multiple of gridSize. gridSize is 75 currently, so possible gameplay sizes are 600 (default), 450, 300.
    // Top text does not scale appropriately, but otherwise gameplay works.
    let gameCanvasSize = 450;
    let topBorderHeight = 50;
    let gridSize;

    let config = {

        // Basic canvas information: size of screen, how to load it (Phaser.AUTO looks for WebGL, etc..)
        type: Phaser.AUTO,
        width: gameCanvasSize,
        height: gameCanvasSize + topBorderHeight,
        parent: parentContainer,

        // Pull in an "arcade physics" engine which we can use to orchestrate gameplay
        physics: {
            default: 'arcade',
            arcade: {
                debug: false
            }
        },
        scene: {
            preload: preload,
            create: create,
            update: update
        }
    };

    let gameState = "start"; // start, pregame, gameplay, postgame
    let pregamePauseDurationMS = 30000; // Used either to tick down, or to count person's start RT
    let gameStartTime = new Date().getTime();

    // Hack... here, we intercept the "full_viz_observer" parameter.
    // If it's a practice round, we don't want to display the concept view regardless.
    let fullVisibilityTeacherView = false;
    let conceptDisplayObjectData = [
        {"x": 14, "y": -4, "value": 1, "mask_value": 0},
        {"x": 20, "y": -4, "value": 1, "mask_value": 1},
        {"x": 26, "y": -4, "value": 1, "mask_value": 2},
        {"x": 32, "y": -4, "value": 1, "mask_value": 3},
        {"x": 51, "y": -4, "value": -1, "mask_value": 0},
        {"x": 57, "y": -4, "value": -1, "mask_value": 1},
        {"x": 63, "y": -4, "value": -1, "mask_value": 2},
        {"x": 69, "y": -4, "value": -1, "mask_value": 3}];

    if (gameRole === "full_viz_observer") {
        gameRole = "observer";
        fullVisibilityTeacherView = true;
        if (gameMode === "practice") {
            conceptDisplayObjectData = [
                {"x": 23, "y": -4, "value": 1, "mask_value": 1, "objectTint": "0x0000FF", "objectShape": "blankCircle"},
                {"x": 60, "y": -4, "value": -1, "mask_value": 1, "objectTint": "0xFF0000", "objectShape": "blankSquare"}]
        }
    }

    // Game variables
    let player;
    let gameplayObjects;
    let conceptDisplayObjects; // Used to render concept shapes in top bar
    let score;
    let currentLevelMaxScore;

    // Game records for export
    let playerLocationList = [];
    let gameEventList = [];

    // Tracking / rendering gameplay frames
    let messageQueueIndex = 0;
    let lastPositionLoggedTime = 0;

    // Within-level timer and text
    let levelTimer;
    let levelTimerText;
    let levelNumberText;

    // Inter-level timer and text
    let interLevelTimer;
    let interLevelText;

    /****************************
     * PHASER GAMEPLAY
     * Loading assets, setting up scene, and callbacks for gameplay.
     ****************************/

    function preload() {

        this.load.image('robot', 'static/images/robot_character_black_background.png');
        this.load.image('topBorder', 'static/images/white_top_border.png');
        this.load.image('topBorderObserver', 'static/images/white_top_border_concept_display.png');


        this.load.image('blankCircle', 'static/images/blank_circle.png');
        this.load.image('blankSquare', 'static/images/blank_square.png');
        this.load.image('hollowSquare', 'static/images/hollow_square.png');
        this.load.image('blankTriangle', 'static/images/blank_triangle.png');
        this.load.image('hollowTriangle', 'static/images/hollow_triangle.png');

        // Set up our trajectory queue
        this.trajectoryPoints = []; // must be of form {'x': [38, 70, 71], 'y': [38, 63, 70]}
        
    }

    // Setup for game world goes here
    function create() {

        // For documentation on Phaser text alignment, see
        // https://stackabuse.com/introduction-to-phaser-3-building-breakout/

        levelNumberText = this.add.text(gameCanvasSize - 16, 8, levelText(),
            {fontSize: gameCanvasSize / 25, fill: '#000'});
        levelNumberText.setDepth(1);
        levelNumberText.setOrigin(1,0);

        levelTimerText = this.add.text(16, 8, timerText(taskConfig.game_metadata.level_duration_seconds),
            {fontSize: gameCanvasSize / 25, fill: '#000', align:'center'});
        levelTimerText.setDepth(1);

        interLevelText = this.add.text(gameCanvasSize / 2, gameCanvasSize / 2 - 10, '',
            {fontSize: 24, fill: '#FFF', align: 'center'});
        interLevelText.setDepth(1);
        interLevelText.setOrigin(.5);

        if (fullVisibilityTeacherView) {
            // Set text to red
            interLevelText.setText("Learner View");
            interLevelText.setColor('#F00');

            // Add a red border around the level to make it clear this is what the learner sees
            let graphics = this.add.graphics();
            graphics.lineStyle(4, 0xff0000, 1);
            graphics.strokeRect(2, topBorderHeight+2, gameCanvasSize-4, gameCanvasSize-4);

        } else if (gameRole === "observer") {
            interLevelText.setText("Waiting for Partner")
        }

        // Render the top border. If we're the second observer panel,
        // then we add static objects to be displayed appropriately.
        topBorder = this.physics.add.staticGroup({key:'border'});
        let topBorderImageFile = (fullVisibilityTeacherView) ? 'topBorderObserver' : 'topBorder';
        topBorder.create(gameCanvasSize/2, topBorderHeight/2, topBorderImageFile).refreshBody();

        // Set our world to the first desired configuration
        gameplayObjects = this.physics.add.group();
        resetWorldFromConfig(this, taskConfig);

        if (fullVisibilityTeacherView) {
            conceptDisplayObjects = this.physics.add.staticGroup({key:'conceptDisplay'});
            resetObjects(this, conceptDisplayObjects, conceptDisplayObjectData);
            conceptDisplayObjects.children.iterate(function (displayObject) {
                displayObject.refreshBody();
            });
        }

        if (gameRole === "observer"){
            gameFrameQueue.length = 0;
        }

        if (gameRole === "player") {
            cursors = this.input.keyboard.createCursorKeys();
            gameState = "pregame";
            player.alpha = .4;
            startPregamePause(this);
        }

    }

    function update(time) {

        // Loading frames from an external source
        if (gameRole === "observer" && gameFrameQueue.length > messageQueueIndex) {

            let newMessage = gameFrameQueue[messageQueueIndex];
            if (typeof newMessage !== 'undefined') {

                if (newMessage.event === "level_end") {
                    interLevelText.setText("Score: " + score + " points");
                    console.log(gameRole + " Phaser recieved shutdown message. Destroying scene.");
                    finishAndDestroyScene(this);
                } else {

                    // Look at the next message in the queue
                    let newFrame = gameFrameQueue[messageQueueIndex]["frame"];
                    if (typeof newFrame !== 'undefined') {
                        updateGameplayState(this, newFrame);
                    }
                }
            }
            // Advance index and keep a record of how many frames we've rendered
            messageQueueIndex += 1;
        }

        else if (gameRole === "human"){

            // If we're still waiting for the kickoff message from the server, check the gameframe queue for it
            if (gameState === "start" && gameFrameQueue.length > 0) {

                console.log("Found trajectory message in queue, starting timer");
                console.log(gameFrameQueue[0]);
                this.trajectoryPoints = gameFrameQueue[0];

                startPregamePause(this);

            } else if (gameState === "pregame") {

                if (typeof(interLevelTimer) !== 'undefined') {
                    let msRemaining = interLevelTimer.delay - interLevelTimer.getElapsed();
                    let secondsRemaining = msRemaining / 1000;
                    interLevelText.setText("Use Arrow Keys to Start\nAuto-start in: " + Math.floor(secondsRemaining));
                }

            } else if (gameState === "gameplay") {

                // Update timer display
                let msRemaining = levelTimer.delay - levelTimer.getElapsed();
                let secondsRemaining = msRemaining / 1000;
                levelTimerText.setText(timerText(secondsRemaining.toFixed(1)));

                // Use the remaining time to figure out how far along the track we should be
                let fracTimeElapsed = levelTimer.getElapsed() / levelTimer.delay;

                // Could also use Phaser.Math.Interpolation.CatmullRom as more of a "curved" interpolation
                const posx = Phaser.Math.Interpolation.Linear(this.trajectoryPoints['x'], fracTimeElapsed);
                const posy = Phaser.Math.Interpolation.Linear(this.trajectoryPoints['y'], fracTimeElapsed);

                player.x = scaleXtoCanvas(posx);
                player.y = scaleYtoCanvas(posy);

            }

        }

        // Regular gameplay
        else if (gameRole === "player") {

            if (gameState === "pregame") {

                if (typeof(interLevelTimer) !== 'undefined') {
                    let msRemaining = interLevelTimer.delay - interLevelTimer.getElapsed();
                    let secondsRemaining = msRemaining / 1000;
                    interLevelText.setText("Use Arrow Keys to Start\nAuto-start in: " + Math.floor(secondsRemaining));
                }

                acceptKeyboardStartInput(this);

            } else if (gameState === "gameplay") {

                messageQueueIndex += 1;

                // Update timer display
                let msRemaining = levelTimer.delay - levelTimer.getElapsed();
                let secondsRemaining = msRemaining / 1000;
                levelTimerText.setText(timerText(secondsRemaining.toFixed(1)));

                //  Log player location every 10th of a second
                let secondsElapsed = (levelTimer.getElapsed() / 1000).toFixed(1);
                if (secondsElapsed > lastPositionLoggedTime) {

                    // Push the player's location to the list of locations
                    let playerLocationEvent = [levelTimer.getElapsed(), scaleXFromCanvas(player.x), scaleYFromCanvas(player.y)];
                    playerLocationList.push(playerLocationEvent);
                    lastPositionLoggedTime = secondsElapsed;

                }

                // Look for player input from keyboard
                acceptKeyboardInput();
            }

            // Inter-level pause mode
            // Package up a new message and send it up
            let newMessage = {"name": "gameplay_frame", "frame": generateFrameRecord()};
            timestepCallback(newMessage);

        }

    }

    function acceptKeyboardInput(){

        // Accept new player input
        let velocity = gameCanvasSize / 10;

        // NOTE TO SELF: If you are trying to debug a cursor issue where they are getting "stuck" (i.e. not updating)
        // then try disabling the Evernote Web Clipper. This appears to interfere with the keyboard controls
        // occasionally, for reasons unknown...
        if (cursors.left.isDown) {
            player.setVelocityX(-velocity);
        } else if (cursors.right.isDown) {
            player.setVelocityX(velocity);
        } else {
            player.setVelocityX(0);
        }

        if (cursors.up.isDown) {
            player.setVelocityY(-velocity);
        } else if (cursors.down.isDown) {
            player.setVelocityY(velocity);
        } else {
            player.setVelocityY(0);
        }

    }

    // Callback function to check if this object is in our list of objects to collect.
    function conditionalCollectHumanAI(player, gameObject) {

        // If we're *not* a human observer, we should definitely collect it.
        if (gameRole !== 'human'){
            return true
        }

        // Otherwise, iterate over our list of destination points
        for (let i = 0; i < this.trajectoryPoints["x"].length; i++) {

            const to_collect_x = this.trajectoryPoints.x[i];
            const to_collect_y = this.trajectoryPoints.y[i];

            const object_x = gameObject.getData('config')["x"];
            const object_y = gameObject.getData('config')["y"];

            // If this object is one of our targets, collect it
            if (to_collect_x === object_x && to_collect_y === object_y) {
                return true
            }
        }

        // Otherwise, *don't* collect it.
        return false
    }

    // Callback function for the player <--> game_object interaction.
    function collectObjectCallback(player, gameObject) {

        score += gameObject.getData('value');

        let objectCollectionEvent = {
            "name": "object_collected",
            "ms_elapsed": levelTimer.getElapsed(),
            "data": {
                "object": gameObject.getData('config'),
                "score": score
            }
        };

        gameEventList.push(objectCollectionEvent);

        // If we had text on the object, delete it
        if (typeof gameObject.getData('text') !== 'undefined') {
            gameObject.getData('text').setText("");
        }

        gameObject.destroy();

    }

    function timerText(seconds){

        if (fullVisibilityTeacherView) {
            return ""
        } else {
            return 'Time: ' + seconds;
        }

    }

    function levelText(){

        if (fullVisibilityTeacherView) {
            return ""
        } else if (gameMode === "practice") {
            return "Practice Round"
        } else {
            return "Level " + levelNumber + ' of ' + totalNumberOfLevels
        }

    }

    /****************************
     * GAME STATE MANAGEMENT
     * handle starting / stopping, level transitions
     ****************************/

    function updateGameplayState(scene, newFrame) {

        // Move player to new location
        player.x = scaleXtoCanvas(newFrame["player"]["x"]);
        player.y = scaleYtoCanvas(newFrame["player"]["y"]);

        // Re-draw objects if this is the first frame or the number changed (i.e. one was picked up)
        if (newFrame["level_frame_counter"] === 1 || gameplayObjects.children.size !== newFrame["objects"].length) {
            resetObjects(scene, gameplayObjects, newFrame["objects"]);
        }

        score = newFrame["score"];

        if (newFrame["ms_remaining"] !== 0) {

            secondsRemaining = newFrame["ms_remaining"] / 1000;
            levelTimerText.setText(timerText(secondsRemaining.toFixed(1)));

            // Wipe inter-level text
            interLevelText.setText("");

        } else if (newFrame["state"] === "pregame") {

            if(!fullVisibilityTeacherView){
                var baseText = "Waiting for Partner";
                let nEllipses = Math.floor((gameFrameQueue.length / 60) % 5);
                interLevelText.setText(baseText + ".".repeat(nEllipses));
            }

        } else if (newFrame["state"] === "postgame") {
            secondsRemaining = newFrame["inter_level_ms_remaining"] / 1000;
            interLevelText.setText("Score: " + score + " points");

        }
    }

    function acceptKeyboardStartInput(scene){

        if(cursors.left.isDown || cursors.right.isDown || cursors.up.isDown || cursors.down.isDown) {
            pregameTimerCallback(scene);
        }
    }


    // Function to kick-off the inter-level phase, including freezing gameplay and displaying score etc.
    function startPostgamePause(scene){

        // Set game state to disallow player input and gray out robot
        gameState = 'postgame';
        interLevelText.setText("Score: " + score + " points");

        // Gray out objects and player to make this obvious
        player.alpha = .4;
        gameplayObjects.children.iterate(function (gameObject) {
            if (typeof gameObject !== 'undefined') {
                gameObject.setAlpha(.5);
            }
        });

        if (gameRole === 'human') {
            console.log("Resetting gameFrameQueue");
            gameFrameQueue.length = 0; // Reset the gameFrameQueue to ensure that the next level starts clean
        }

        finishAndDestroyScene(scene);

    }

    // Function to reset the game
    function startPregamePause(scene) {

        gameState = 'pregame';
        player.alpha = .4;

        messageQueueIndex = 0;
        interLevelTimer = scene.time.delayedCall(pregamePauseDurationMS, pregameTimerCallback, [scene], this)

    }

    function pregameTimerCallback(scene){

        pregamePauseDurationMS = new Date().getTime() - gameStartTime;
        interLevelTimer.remove();

        // Wipe out inter-level text
        interLevelText.setText('');

        // Set game state to allow for play to resume
        player.setAlpha(1);
        gameState = 'gameplay';

        // Set level timer based on config. Phaser timers are a bit tricky, see the docs.
        // https://rexrainbow.github.io/phaser3-rex-notes/docs/site/timer/
        let gameDurationMS = taskConfig.game_metadata.level_duration_seconds * 1000;
        levelTimer = scene.time.delayedCall(gameDurationMS, levelTimerCallback, [scene], this);

    }

    // Pause is over-- we're well and truly done here!
    function finishAndDestroyScene(scene) {

        scene.sys.game.destroy(false, true);

    }

    // Handle the level ending.
    // Freeze player, save gameplay record, run completion callback, then pause.
    function levelTimerCallback(scene) {

        player.setVelocityX(0);
        player.setVelocityY(0);

        // Super important: write all data from this round out to PsiTurk, etc
        gameplayEndCallback(generateFullGameRecord());

        startPostgamePause(scene);

    }

    /****************************
     * IMPORTING DATA
     * in which objects are loaded from JSON configuration and scene data.
     ****************************/

    // Given a new config, reset everything to that.
    function resetWorldFromConfig(scene, newWorldConfiguration) {

        // update task configuration so all functions have access to it
        taskConfig = newWorldConfiguration;

        gridSize = taskConfig.game_metadata.grid_size;
        // Load frame data and color mask from config
        resetPlayer(scene, taskConfig.frame_data.player);
        resetObjects(scene, gameplayObjects, taskConfig.frame_data.objects);

        // Interaction between player and objects
        if (gameRole === "player" || gameRole === "human") {
            scene.physics.add.overlap(player, gameplayObjects, collectObjectCallback, conditionalCollectHumanAI, scene);
        }

        // Initialize our game state record to our starting frame
        playerLocationList = [];
        gameEventList = [];

        // Initialize score from config
        score = taskConfig.frame_data.score;
        currentLevelMaxScore = taskConfig.game_metadata.max_cluster_value;

        // Set next level number
        levelNumberText.setText(levelText());
        levelTimerText.setText(timerText(taskConfig.game_metadata.level_duration_seconds));

    }

    function resetPlayer(scene, playerConfig) {

        if (player != null) {
            player.destroy();
        }

        player = scene.physics.add.sprite(
            scaleXtoCanvas(playerConfig["x"]),
            scaleYtoCanvas(playerConfig["y"]),
            'robot');

        // the sprites are all 100 pixels, so we can translate that directly to a scaling factor.
        player.setScale(scaleSpriteToCanvas(taskConfig.game_metadata.player_size, 100));

        if (gameRole === "player") {
            player.setCollideWorldBounds(true);
            scene.physics.add.collider(player, topBorder);
        }
    }

    function resetObjects(scene, oldObjectArray, objectsConfig) {

        // Loop over objects and delete text if there is any.
        oldObjectArray.children.iterate(function (gameObject) {
            if (typeof gameObject !== 'undefined') {
                // If we had text on the object, delete it
                if (typeof gameObject.getData('text') !== 'undefined') {
                    gameObject.getData('text').destroy();
                }
            }
        });

        // Clear existing objects and reset possible score to zero
        oldObjectArray.clear(true);

        for (let i = 0; i < objectsConfig.length; i++) {

            // Grab the entry from our input JSON
            let objectData = objectsConfig[i];

            let objectShape;
            let objectTint;


            // First check if the value mask specifies a shape / color --> teacher "no viz" mask
            if (valueMaskConfig.hasOwnProperty("objectShape") && valueMaskConfig.hasOwnProperty("objectTint")) {

                // If it has shape and color defined, use those
                objectShape = valueMaskConfig.objectShape;   // Must be name of image to use from Phaser pre-load step
                objectTint = valueMaskConfig.objectTint;     // Must be hex string designating color

            // Second, see if object itself specifies a shape / color --> practice rounds
            } else if (objectData.hasOwnProperty("objectShape") && objectData.hasOwnProperty("objectTint")) {

                objectShape = objectData.objectShape;   // Must be name of image to use from Phaser pre-load step
                objectTint = objectData.objectTint;     // Must be hex string designating color

            // Finally, for regular gameplay: use boolean feature mask to define the shape and color
            } else {

                let featureString = booleanComplexityToFeatureString(objectData.value, objectData.mask_value,
                    valueMaskConfig["concept_complexity"]);

                // Counterbalance feature string as needed
                if (valueMaskConfig.hasOwnProperty("counterbalance")){
                    featureString = counterbalanceFeatureString(featureString, valueMaskConfig["counterbalance"]);
                }

                objectShape = booleanFeatureStringToShape(featureString);
                objectTint = booleanFeatureStringToColor(featureString);
            }


            // Create and set color
            let newObject = oldObjectArray.create(scaleXtoCanvas(objectData.x), scaleYtoCanvas(objectData.y), objectShape);
            newObject.tint = objectTint;

            let objectScale = scaleSpriteToCanvas(taskConfig.game_metadata.object_size, 100);
            newObject.setScale(objectScale);

            // Set object value and config information
            newObject.setData('value', objectData.value);
            newObject.setData('config', objectData);

            if (valueMaskConfig.hasOwnProperty("text")) {
                // This one's a little funky-- actually writes directly into the object itself.
                objectTextFunction(newObject, valueMaskConfig["text"], scene);
            }
        }
    }

    // Flip bits in featureString according to the counterbalance number
    function counterbalanceFeatureString(featureString, counterbalanceCondition) {

        // Use lower 3 bits of counterbalance to perform a bitwise OR on the features
        let counterbalanceFeatureFlip  = Math.floor(counterbalanceCondition % 8);
        let originalFeatureInteger = parseInt(featureString, 2);
        let bitFlippedFeatures = originalFeatureInteger ^ counterbalanceFeatureFlip;
        let bitFlippedString = bitFlippedFeatures.toString(2).padStart(3, "0");

        // Use top bits of counterbalance to shuffle feature ordering
        let counterbalanceFeatureShuffle = Math.floor(counterbalanceCondition / 8);
        let shuffledFlippedString = _shuffleFeatureStringOrder(bitFlippedString, counterbalanceFeatureShuffle);

        // for debugging purposes
        // let counterbalanceConditionString = counterbalanceFeatureFlip.toString(2);
        // console.log("Counterbalance condition: " + counterbalanceCondition);
        // console.log("Bit-Flip config: " + counterbalanceFeatureFlip);
        // console.log("Bit-Flip process: " + featureString + " ^ " + counterbalanceConditionString + " --> " + bitFlippedString);
        //
        // console.log("Shuffling config: " + counterbalanceFeatureShuffle);
        // console.log("Shuffling process: " + bitFlippedString + " --> " + shuffledFlippedString);

        return shuffledFlippedString

    }

    function _shuffleFeatureStringOrder(f, counterbalance) {

        switch (counterbalance) {
            case 0:
                return f[0] + f[1] + f[2];
            case 1:
                return f[0] + f[2] + f[1];
            case 2:
                return f[1] + f[0] + f[2];
            case 3:
                return f[1] + f[2] + f[0];
            case 4:
                return f[2] + f[0] + f[1];
            case 5:
                return f[2] + f[1] + f[0];
            default:
                throw "Invalid feature shuffling counterbalance value (must be 0-5): " + counterbalance;
        }


    }
    /****************************
     * EXPORTING SCENE DATA
     * in which objects are converted to JSON to log or pass between players.
     ****************************/

    function generateFullGameRecord() {

        if (valueMaskConfig.hasOwnProperty("counterbalance") &&
            valueMaskConfig.hasOwnProperty("concept_complexity")){

            for (let i = 0; i < conceptDisplayObjectData.length; i++) {

                let featureString = booleanComplexityToFeatureString(conceptDisplayObjectData[i].value,
                    conceptDisplayObjectData[i].mask_value,
                    valueMaskConfig["concept_complexity"]);

                featureString = counterbalanceFeatureString(featureString, valueMaskConfig["counterbalance"]);
                conceptDisplayObjectData[i]["shape"] = booleanFeatureStringToShape(featureString);
                conceptDisplayObjectData[i]["color"] = booleanFeatureStringToColor(featureString);
            }
        }
        // console.log(conceptDisplayObjectData);

        // Patch together log of game
        let fullGameRecord = {

            /// IMPORTANT-- USED FOR BONUS CALCULATION
            "name": "full_game_record",
            "phase": "gameplay",
            "event": "level_end",
            "mode": gameMode,
            "config_name": taskConfig.game_metadata.name,
            "score": score,
            "level_max_score": currentLevelMaxScore,

            // Setup configuration
            "level": levelNumber,
            "task_uuid": uniqueId,
            "task_configuration": partnerPairCondition,
            "config": taskConfig,
            "value_mask_config": valueMaskConfig,
            "concept_display": conceptDisplayObjectData,

            // Outcomes
            "pregame_pause_ms": pregamePauseDurationMS,
            "game_events": gameEventList,
            "player_locations": playerLocationList

        };
        // console.log(fullGameRecord);

        return fullGameRecord;

    }

    function generateFrameRecord() {
        // Loop over objects, player, and score --> export
        // Same format as used to "load" scene.

        const sceneState = {
            "player": playerToJSON(),
            "objects": objectsToJSON(),
            "score": score,
            "state": gameState,
            "ms_elapsed": (typeof(levelTimer) !== 'undefined') ? levelTimer.getElapsed() : 0,
            "ms_remaining": (typeof(levelTimer) !== 'undefined') ? levelTimer.delay - levelTimer.getElapsed() : 0,
            "inter_level_ms_remaining": (typeof(interLevelTimer) !== 'undefined') ? interLevelTimer.delay - interLevelTimer.getElapsed() : 0,
            "level_number": levelNumber
        };

        return (sceneState)

    }

    function objectsToJSON() {

        let objectList = [];

        gameplayObjects.children.iterate(function (gameObject) {
            objectList.push(gameObject.getData('config'));
        });

        return objectList

    }

    function playerToJSON() {

        const playerData = {
            "x": scaleXFromCanvas(player.x),
            "y": scaleYFromCanvas(player.y)
        };

        return playerData;

    }

    /****************************
     * COLORS, SHAPES, AND TEXT
     * in which objects are colored, shaped, and labeled appropriately.
     ****************************/

    function booleanFeatureStringToColor(featureString){

        if(featureString[0] === '0') {
            // Cyan
            return rgbToHex(0, 255,255);
        } else if (featureString[0] === '1') {
            // Magenta
            return rgbToHex(255, 0, 255);
        }

        throw "Invalid boolean feature string for color determination: " + featureString;

    }

    function booleanFeatureStringToShape(featureString) {

        var shapeString = "";

        if (featureString[2] === '0') {
            shapeString += "blank";
        } else if (featureString[2] === '1') {
            shapeString += "hollow";
        } else {
            throw "Invalid boolean feature string for filled / solid determination: " + featureString;
        }

        if (featureString[1] === '0') {
            shapeString += "Square";
        } else if (featureString[1] === '1') {
            shapeString += "Triangle";
        } else {
            throw "Invalid boolean feature string for shape determination: " + featureString;
        }



        return shapeString;
    }

    function booleanComplexityToFeatureString(objectValue, objectFeatureIndex, conceptComplexity){
        // Map from +/-, display number, and concept complexity to a string encoding feature settings.

        switch(conceptComplexity) {
            case 1:
                switch(objectValue) {
                    case 1:
                        return Array("000", "001", "010", "011")[objectFeatureIndex];
                    case -1:
                        return Array("100", "101", "110", "111")[objectFeatureIndex];
                    default:
                        throw "Invalid Object Value / Feature Index configuration.";

                }

            case 2:
                switch(objectValue) {
                    case 1:
                        return Array("010", "011", "100", "101")[objectFeatureIndex];
                    case -1:
                        return Array("000", "001", "110", "111")[objectFeatureIndex];
                    default:
                        throw "Invalid Object Value / Feature Index configuration.";
                }

            case 3:
                switch(objectValue) {
                    case 1:
                        return Array("001", "010", "011", "110")[objectFeatureIndex];
                    case -1:
                        return Array("000", "100", "101", "111")[objectFeatureIndex];
                    default:
                        throw "Invalid Object Value / Feature Index configuration.";
                }

            case 4:
                switch(objectValue) {
                    case 1:
                        return Array("001", "010", "011", "111")[objectFeatureIndex];
                    case -1:
                        return Array("000", "100", "101", "110")[objectFeatureIndex];
                    default:
                        throw "Invalid Object Value / Feature Index configuration.";
                }

            case 5:
                switch(objectValue) {
                    case 1:
                        return Array("001", "010", "011", "100")[objectFeatureIndex];
                    case -1:
                        return Array("000", "101", "110", "111")[objectFeatureIndex];
                    default:
                        throw "Invalid Object Value / Feature Index configuration.";
                }

            case 6:
                switch(objectValue) {
                    case 1:
                        return Array("000", "011", "101", "110")[objectFeatureIndex];
                    case -1:
                        return Array("001", "010", "100", "111")[objectFeatureIndex];
                    default:
                        throw "Invalid Object Value / Feature Index configuration.";
                }

            default:
                throw "Invalid Concept Complexity configuration: must be 1-6 inclusive, got " + conceptComplexity;

        }}

    function objectTextFunction(gameObject, textConfig, scene) {

        const textContent = gameObject.getData(textConfig["key"]);

        let objectText = scene.add.text(gameObject.x, gameObject.y, textContent,
            {fontFamily: 'Arial', fontSize: 14});

        if (textConfig.hasOwnProperty('color')) {

            if (textConfig["color"] === "intuitive_red_green") {
                if (textContent > 0) {
                    objectText.setTint("0x00FF00");
                } else {
                    objectText.setTint("0xFF0000");
                }
            } else {
                objectText.setTint("0xFFFFFF");
            }
        }

        objectText.setOrigin(.5,.5);

        gameObject.setData("text", objectText);

    }

    function rgbToHex(r, g, b) {
        // Helper function from the intertubes to convert RGB tuple to hex string
        // https://stackoverflow.com/questions/5623838/rgb-to-hex-and-hex-to-rgb/5624139#5624139
        return "0x" + ((1 << 24) + (r << 16) + (g << 8) + b).toString(16).slice(1);
    }

    /****************************
     * MAPPING TO CANVAS
     * in which objects are placed on the canvas and scaled appropriately.
     ****************************/

    function scaleSpriteToCanvas(spriteGridWidth, spritePixelWidth) {

        let spritePixelSize = scaleXtoCanvas(spriteGridWidth);
        return spritePixelSize / spritePixelWidth;

    }

    function scaleXFromCanvas(pixelValue){
        // Take X encoded as a pixel location and return grid location on screen

        gridPixelWidth = gameCanvasSize / gridSize;

        return pixelValue / gridPixelWidth;
    }

    function scaleYFromCanvas(pixelValue){
        // Take Y encoded as a pixel location and return relative location on screen

        gridPixelHeight = gameCanvasSize / gridSize;
        trueYPixelValue = pixelValue - topBorderHeight;

        return trueYPixelValue / gridPixelHeight;
    }

    function scaleXtoCanvas(gridValue){
        // Take X encoded as grid value (i.e. 0 = far left of screen, gridValue = far right) and return
        // a pixel location based on current screen scale

        gridPixelWidth = gameCanvasSize / gridSize;

        return gridPixelWidth * gridValue;
    }

    function scaleYtoCanvas(gridValue){
        // Take Y encoded as grid value (i.e. 0 = far left of screen, gridValue = bottom) and return
        // a pixel location based on current screen scale

        gridPixelHeight = gameCanvasSize / gridSize;

        return gridPixelHeight * gridValue + topBorderHeight;
    }

    return new Phaser.Game(config);

};

