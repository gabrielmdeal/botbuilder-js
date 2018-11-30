/**
 * @module botbuilder-applicationinsights
 */
/**
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */
import { BotTelemetryClient, Severity, TelemetryDependency, TelemetryEvent, TelemetryException, TelemetryTrace } from 'botbuilder-core';
import appInsights = require('applicationinsights');
import cls from 'cls-hooked'
const ns = cls.createNamespace('my.request');

// This is the currently recommended work-around for using Application Insights with async/await
// https://github.com/Microsoft/ApplicationInsights-node.js/issues/296
// This allows AppInsights to automatically apply the appropriate context objects deep inside the async/await chain.
import { CorrelationContextManager } from 'applicationinsights/out/AutoCollection/CorrelationContextManager';
import { Envelope, TraceTelemetry, ExceptionTelemetry, EventTelemetry, DependencyTelemetry } from 'applicationinsights/out/Declarations/Contracts';
const origGetCurrentContext = CorrelationContextManager.getCurrentContext;

function getCurrentContext(){
  return ns.get('ctx') || origGetCurrentContext();
}

// Overwrite the built-in getCurrentContext() method with a new one.
CorrelationContextManager.getCurrentContext = getCurrentContext;

export const ApplicationInsightsWebserverMiddleware = function (req, res, next) {

  // Check to see if the request contains an incoming request.
  // If so, set it into the Application Insights context.
  const activity = req.body;
  if (activity && activity.id) {
    const context = appInsights.getCorrelationContext();
    context['activity'] = req.body;
  }

  ns.bindEmitter(req);
  ns.bindEmitter(res);
  ns.run(function(){
    ns.set('ctx', origGetCurrentContext());
    next();
  });

};


/* ApplicationInsightsTelemetryClient Class
 * This is a wrapper class around the Application Insights node client.
 * This is primarily designed to be used alongside the WaterfallDialog telemetry collection.
 * It provides a pre-configured App Insights client, and wrappers around
 * the major tracking functions, allowing it to conform to Botbuilder's generic BotTelemetryClient interface.
 * To use it, create pass in an instrumentation key:
 * 
 * ```
 * const myDialog = new WaterfallDialog('my_dialog', steps);
 * const appInsightsClient = new ApplicationInsightsTelemetryClient(my_instrumentation_key);
 * myDialog.telemetryClient = appInsightsClient;
 * ```
 */
export class ApplicationInsightsTelemetryClient implements BotTelemetryClient {

    private _telemetryClient: appInsights.TelemetryClient;
    private _configuration: appInsights.Configuration;

    /* The settings parameter is passed directly into appInsights.setup().
     * https://www.npmjs.com/package/applicationinsights#basic-usage
     * This function currently takes an app insights instrumentation key only.
     */
    constructor(instrumentationKey: string) {

        this._configuration = appInsights.setup(instrumentationKey)
        .setAutoDependencyCorrelation(true)
        .setAutoCollectRequests(true)
        .setAutoCollectPerformance(true)
        .setAutoCollectExceptions(true)
        .setAutoCollectDependencies(true)
        .start(); 

        this._telemetryClient = appInsights.defaultClient;

        this._telemetryClient.addTelemetryProcessor(addBotIdentifiers);
    }

    /* configuration() 
     * Provides access to the Application Insights configuration that is running here.
     * Allows developers to adjust the options, for example:
     * `appInsightsClient.configuration.setAutoCollectDependencies(false)`
     */
    get configuration(): appInsights.Configuration {
        return this._configuration;
    }

    /* defaultClient()
     * Provides direct access to the telemetry client object, which might be necessary for some operations.
     */
    get defaultClient() {
        return this._telemetryClient;
    }

    trackDependency(telemetry: TelemetryDependency) {
        this._telemetryClient.trackDependency(telemetry as DependencyTelemetry);
    }

    trackEvent(telemetry: TelemetryEvent)  {
        this._telemetryClient.trackEvent(telemetry as EventTelemetry);
    }

    trackException(telemetry: TelemetryException)  {
        this._telemetryClient.trackException(telemetry as ExceptionTelemetry)
    }

    trackTrace(telemetry: TelemetryTrace) {
        this._telemetryClient.trackTrace(telemetry as TraceTelemetry);
    }

    flush()  {
        this._telemetryClient.flush();
    }

}

/* Define the telemetry initializer function which is responsible for setting the userId. sessionId and some other values
 * so that application insights can correlate related events.
 */
function addBotIdentifiers(envelope: Envelope, context: { [name: string]: any }): boolean {
    if (context.correlationContext && context.correlationContext.activity) {
        const activity = context.correlationContext.activity;
        const telemetryItem = envelope.data['baseData']; // have to use bracket notation here because baseData is not in TS definition.
        const userId = activity.from ? activity.from.id : '';
        const channelId = activity.channelId || '';
        const conversationId = activity.conversation ? activity.conversation.id : '';

        // set user id and session id
        envelope.tags[appInsights.defaultClient.context.keys.userId] = channelId + userId;
        envelope.tags[appInsights.defaultClient.context.keys.sessionId] = conversationId;

        // Add additional properties
        telemetryItem.properties = telemetryItem.properties || {};
        telemetryItem.properties.activityId = activity.id;
        telemetryItem.properties.channelId = channelId;
        telemetryItem.properties.activityType = activity.type;
    }
    
    return true;
}