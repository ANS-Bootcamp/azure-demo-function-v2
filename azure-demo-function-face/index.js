module.exports = async function (context, myBlob) {

    //Import Modules
    var Vision = require('azure-cognitiveservices-vision');
    var CognitiveServicesCredentials = require('ms-rest-azure').CognitiveServicesCredentials;
    var azure = require('azure-storage');
    var request = require("request-promise");
    
    //Source Image Uri
    var imageUri = context.bindingData.uri;
    context.log("Image Uri: " + imageUri);
    
    //Split https:// from url
    var imageUriArray = imageUri.split("//");
    //Split url path
    imageUriArray = imageUriArray[1].split("/")

    //Create Blob Service
    var blobService = azure.createBlobService();

    //Creates container if not exists
    blobService.createContainerIfNotExists('thumbs', {publicAccessLevel : 'blob'}, function(error) {
        if(error) {
            context.log(error);
        };
    });

    //Replace "images" container to "thumbs"
    imageUriArray[1] = "thumbs"

    //Build url path
    var thumbsPath = imageUriArray.join("/");
    var thumbUri = "https://" + thumbsPath;
    context.log("Thumbnail Uri: " + thumbUri);

    //Cognitive Services API Credentials
    var keyCognitive = 'AZURE_COGNITIVE_SERVICES_KEY';
    var keyRegion = 'AZURE_COGNITIVE_SERVICES_REGION';
    
    if (!process.env[keyCognitive] || !process.env[keyRegion]) {
    throw new Error('please set/export the following environment variables: ' + keyCognitive + ' ' + keyRegion);
    }

    var serviceKey = process.env[keyCognitive];
    var region =process.env[keyRegion];
    var endpoint =  'https://'+region +'.api.cognitive.microsoft.com';
    var credentials = new CognitiveServicesCredentials(serviceKey);
    var faceApiClient = new Vision.FaceAPIClient(credentials, endpoint);

    context.log("Image name: " + context.bindingData.name);

    //Call Face Service
    await imageQuery();

    //Call Thumbnail Service
    await thumbnail(imageUri);

    
    //Function to get Face Attributes
    async function imageQuery(){
        context.log("Calling Face API");

        await faceApiClient.face.detectWithStream(myBlob, {returnFaceAttributes: ['age','gender','smile','facialHair','glasses','emotion','hair','makeup']})
        
            .then(async function(data){    
                //write to azure table
                context.log("data: " + JSON.stringify(data));
                context.bindings.imageTableInfo = [];
                context.bindings.imageTableInfo.push({
                    PartitionKey: 'face',
                    RowKey: context.bindingData.name,
                    data: {
                        "api" : "face",
                        "imageUri" : imageUri,
                        "thumbUri" : thumbUri,
                        "faceAttributes" : data[0].faceAttributes
                    }
                })

                //Call Thumbnail Service
                await thumbnail(imageUri);

                //Completed
                context.done(null);

            })

            .catch(function(err) {
                context.log('Error: ' + err);
                context.done(null, 'err');
            })

    };  

    //Function to create Thumbnail
    async function thumbnail(imageUri) {
        context.log("Calling Thumbnail API");

        var options = { 
            method: 'POST',
            url: 'https://'+region+'.api.cognitive.microsoft.com/vision/v1.0/generateThumbnail',
            qs: { width: '95', height: '95', smartCropping: 'true' },
            headers: { 
                'Cache-Control': 'no-cache',
                'Ocp-Apim-Subscription-Key': serviceKey,
                'Content-Type': 'application/json' 
            },
            body: { url: imageUri },
            encoding: null,
            json: true
        };

        await request(options)
            .then(function (body) {
                //Write to Blob storage
                context.bindings.outputBlob = body;
            })
            .catch(function (err) {
                context.log("No Output Blob");
                context.log("Error: "+ err);
                context.done(null, err);
            });
    
    };

};
