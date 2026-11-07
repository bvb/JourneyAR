// Restored "Shield" shader: the light cone in front of the Creature's head (material Ramp).
// The ripped project lost it (Ramp.mat fell back to Standard and rendered as a black pyramid);
// this is the GLES program of the original 2012 build (android-ar-viewer.1.0,
// sharedassets0.assets, Unity 3.5.5) rewritten in Cg:
//   facing = |dot(object-space view direction, normal)| per vertex,
//   ramp   = _RampTex(facing, 0.5) * _Color.a,
//   colour = _SurfaceTex(uv + (0, _Offset)) * ramp * _Color, added to the frame (Blend One One).
Shader "Shield" {
Properties {
 _Offset ("Time", Range(0,1)) = 0
 _Color ("Tint (RGB)", Color) = (1,1,1,1)
 _SurfaceTex ("Texture (RGB)", 2D) = "white" {}
 _RampTex ("Facing Ratio Ramp (RGB)", 2D) = "white" {}
}
SubShader {
 Tags { "Queue"="Transparent" }
 Pass {
  Tags { "Queue"="Transparent" }
  ZWrite Off
  Cull Off
  Blend One One
  CGPROGRAM
  #pragma vertex vert
  #pragma fragment frag
  #include "UnityCG.cginc"

  float _Offset;
  float4 _Color;
  sampler2D _SurfaceTex;
  float4 _SurfaceTex_ST;
  sampler2D _RampTex;

  struct v2f {
   float4 pos : SV_POSITION;
   float2 uv : TEXCOORD0;
   float facing : TEXCOORD1;
  };

  v2f vert (appdata_base v) {
   v2f o;
   o.pos = UnityObjectToClipPos(v.vertex);
   o.facing = abs(dot(normalize(ObjSpaceViewDir(v.vertex)), normalize(v.normal)));
   float2 uv = v.texcoord.xy;
   uv.y += _Offset;
   o.uv = TRANSFORM_TEX(uv, _SurfaceTex);
   return o;
  }

  fixed4 frag (v2f i) : SV_Target {
   fixed4 ramp = tex2D(_RampTex, float2(i.facing, 0.5)) * _Color.a;
   fixed4 c = tex2D(_SurfaceTex, i.uv) * ramp * _Color;
   return fixed4(c.rgb, ramp.r);
  }
  ENDCG
 }
}
Fallback "Legacy Shaders/Transparent/VertexLit"
}
