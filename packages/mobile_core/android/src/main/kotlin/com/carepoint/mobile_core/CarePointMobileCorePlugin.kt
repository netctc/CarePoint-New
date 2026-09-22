package com.carepoint.mobile_core

import android.app.Activity
import android.content.Intent
import android.graphics.Bitmap
import android.provider.MediaStore
import io.flutter.embedding.engine.plugins.FlutterPlugin
import io.flutter.embedding.engine.plugins.activity.ActivityAware
import io.flutter.embedding.engine.plugins.activity.ActivityPluginBinding
import io.flutter.plugin.common.MethodCall
import io.flutter.plugin.common.MethodChannel
import io.flutter.plugin.common.PluginRegistry
import java.io.ByteArrayOutputStream
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

class CarePointMobileCorePlugin : FlutterPlugin, MethodChannel.MethodCallHandler, ActivityAware, PluginRegistry.ActivityResultListener {
    private lateinit var channel: MethodChannel
    private var activity: Activity? = null
    private var activityBinding: ActivityPluginBinding? = null
    private var pendingResult: MethodChannel.Result? = null
    private var pendingSource: String? = null

    override fun onAttachedToEngine(binding: FlutterPlugin.FlutterPluginBinding) {
        channel = MethodChannel(binding.binaryMessenger, CHANNEL)
        channel.setMethodCallHandler(this)
    }

    override fun onDetachedFromEngine(binding: FlutterPlugin.FlutterPluginBinding) {
        channel.setMethodCallHandler(null)
    }

    override fun onAttachedToActivity(binding: ActivityPluginBinding) {
        activityBinding = binding
        activity = binding.activity
        binding.addActivityResultListener(this)
    }

    override fun onDetachedFromActivityForConfigChanges() {
        detachActivity()
    }

    override fun onReattachedToActivityForConfigChanges(binding: ActivityPluginBinding) {
        onAttachedToActivity(binding)
    }

    override fun onDetachedFromActivity() {
        detachActivity()
    }

    private fun detachActivity() {
        activityBinding?.removeActivityResultListener(this)
        activityBinding = null
        activity = null
    }

    override fun onMethodCall(call: MethodCall, result: MethodChannel.Result) {
        if (call.method != "pickPhoto") {
            result.notImplemented()
            return
        }
        if (pendingResult != null) {
            result.error("PHOTO_PICKER_BUSY", "A photo selection is already in progress.", null)
            return
        }
        val currentActivity = activity
        if (currentActivity == null) {
            result.error("NO_ACTIVITY", "Photo picker requires an attached Activity.", null)
            return
        }
        val source = call.argument<String>("source") ?: "gallery"
        val intent = when (source) {
            "camera" -> Intent(MediaStore.ACTION_IMAGE_CAPTURE)
            "gallery" -> Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
                type = "image/*"
                addCategory(Intent.CATEGORY_OPENABLE)
            }
            else -> {
                result.error("INVALID_SOURCE", "Photo source must be camera or gallery.", null)
                return
            }
        }
        if (intent.resolveActivity(currentActivity.packageManager) == null) {
            result.error("SOURCE_UNAVAILABLE", "No application can provide the requested photo source.", null)
            return
        }
        pendingResult = result
        pendingSource = source
        currentActivity.startActivityForResult(intent, if (source == "camera") REQUEST_CAMERA else REQUEST_GALLERY)
    }

    override fun onActivityResult(requestCode: Int, resultCode: Int, data: Intent?): Boolean {
        if (requestCode != REQUEST_CAMERA && requestCode != REQUEST_GALLERY) return false
        val result = pendingResult ?: return false
        pendingResult = null
        val source = pendingSource
        pendingSource = null
        if (resultCode != Activity.RESULT_OK) {
            result.success(null)
            return true
        }
        try {
            val bytes = if (source == "camera") {
                val bitmap = data?.extras?.get("data") as? Bitmap
                    ?: throw IllegalStateException("Camera returned no image.")
                ByteArrayOutputStream().use { stream ->
                    if (!bitmap.compress(Bitmap.CompressFormat.JPEG, 88, stream)) {
                        throw IllegalStateException("Camera image could not be encoded.")
                    }
                    stream.toByteArray()
                }
            } else {
                val uri = data?.data ?: throw IllegalStateException("Gallery returned no image URI.")
                activity?.contentResolver?.openInputStream(uri)?.use { it.readBytes() }
                    ?: throw IllegalStateException("Gallery image could not be read.")
            }
            result.success(
                mapOf(
                    "bytes" to bytes,
                    "capturedAt" to utcNow(),
                ),
            )
        } catch (error: Throwable) {
            result.error("PHOTO_READ_FAILED", error.message ?: "Photo could not be read.", null)
        }
        return true
    }

    private fun utcNow(): String = SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", Locale.US).apply {
        timeZone = TimeZone.getTimeZone("UTC")
    }.format(Date())

    companion object {
        private const val CHANNEL = "carepoint/mobile/photo_picker"
        private const val REQUEST_CAMERA = 7311
        private const val REQUEST_GALLERY = 7312
    }
}
