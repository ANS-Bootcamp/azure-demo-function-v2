module.exports = async function (context, myBlob) {
  //Log Started
  context.log("Text Processing Function Started!!!!");

  //Import Modules
  var Vision = require('azure-cognitiveservices-vision');
  var CognitiveServicesCredentials = require('ms-rest-azure').CognitiveServicesCredentials;
  var azure = require('azure-storage');
  var request = require("request-promise");

  //Timeout Function
  const timeout = ms => new Promise(resolve => setTimeout(resolve, ms));

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
  blobService.createContainerIfNotExists('thumbs', {
      publicAccessLevel: 'blob'
  }, function (error) {
      if (error) {
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
  var region = process.env[keyRegion];
  //var endpoint =  'https://'+region +'.api.cognitive.microsoft.com';
  var credentials = new CognitiveServicesCredentials(serviceKey);
  var computerVisionApiClient = new Vision.ComputerVisionAPIClient(credentials, region);


  context.log("Image name: " + context.bindingData.name);

  //Call Image Service
  await imageQuery();

  //Function to get Image Attributes
  async function imageQuery() {
      context.log("Calling Handwriting API");

      await computerVisionApiClient.recognizeTextInStreamWithHttpOperationResponse(myBlob, {detectHandwriting: true})
      
          .then(async function (data){
              var operationLocation = data.response.headers['operation-location'];
              context.log("Operation Location: " + operationLocation);
              operationId=operationLocation.split("/")[6]
              context.log("OperationId: " + operationId);
              
              //Call Text Service
              await getText(operationId);

          })

          .catch(function(err) {
              context.log("Error with image query");
              context.log("Error: " + err);
              context.done(null, err);
          })

  };

  //Function to get handwriting results
  async function getText(operationId) {
      
      context.log("Getting Text Results");
      await getTextResult(operationId);

      //Function to get text results
      async function getTextResult(operationId){
      
      // Make the call to Azure
      await computerVisionApiClient.getTextOperationResult(operationId)

          .then(async function(data){

              if(data.status == "Running"){
                  // Log that the job is still running
                  context.log("Running...");
                  
                  //Wait 5 Seconds
                  await timeout(5000);

                  //Trigger Function Again            
                  await getTextResult(operationId);
              }
              else if(data.status == "NotStarted"){
                  // Log that the job is still starting
                  context.log("Not Started...");

                  //Wait 5 Seconds
                  await timeout(5000);
                  
                  //Trigger Function Again            
                  await getTextResult(operationId);
              }
              else if(data.status == "Succeeded") {
                  // Log that the job has succeeded
                  context.log("Succeeded...");
                  
                  //Format results
                  var handwriting = "";
                  data.recognitionResult.lines.forEach(function(line) {
                      handwriting = handwriting + line.text + "\r\n";
                      });
                  context.log(handwriting);

                  //Write to tables storage
                  context.log("Writing to table storage");
                  context.bindings.imageTableInfo = [];
                  context.bindings.imageTableInfo.push({
                      PartitionKey: 'text',
                      RowKey: context.bindingData.name,
                      data: {
                          "api" : "text",
                          "imageUri" : imageUri,
                          "thumbUri" : thumbUri,
                          "handwriting": handwriting
                      }
                  })

                  //Call Thumbnail Service
                  await thumbnail(imageUri);

                  //Complete
                  context.done(null);
              }
              else{
                  context.log("Unknown Status" + data.status);
                  context.done(null, data.status);
              };

          })

          .catch(function(err){
              context.log("Error getting text");
              context.log("Error: " + err);
              context.done(null, err);
          })

      };
      
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